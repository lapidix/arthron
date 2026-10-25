import { describe, expect, it, vi } from "vitest";
import { parseNdjson, parseSse } from "./stream-parser";

const stream = (...chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
  );

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
};

describe("parseSse", () => {
  it("dispatches one event per blank line with type, data, id and reconnectionTime", async () => {
    const events = await collect(
      parseSse(
        stream(
          "event: tick\nid: 1\nretry: 500\ndata: hello\n\n",
          "data: world\n\n",
        ),
      ),
    );
    expect(events).toEqual([
      {
        type: "tick",
        id: "1",
        lastEventId: "1",
        reconnectionTime: 500,
        data: "hello",
      },
      // id and the reconnection time are stream state: they carry on to the next event.
      {
        type: "message",
        data: "world",
        lastEventId: "1",
        reconnectionTime: 500,
      },
    ]);
  });
  it("joins multiple data lines with \\n and strips one leading space", async () => {
    const [e] = await collect(
      parseSse(stream("data: a\ndata:b\ndata:  c\n\n")),
    );
    expect(e?.data).toBe("a\nb\n c");
  });
  it("ignores comments and reassembles chunks split mid-line and across CRLF", async () => {
    const events = await collect(
      parseSse(stream(": keep-alive\r\nda", 'ta: {"x":1}\r\n\r\n')),
    );
    expect(events).toEqual([
      { type: "message", data: '{"x":1}', lastEventId: "" },
    ]);
  });
  it("treats a CRLF split across two chunks as one line break", async () => {
    const events = await collect(
      parseSse(stream("data: a\r", "\ndata: b\r\n\r\n")),
    );
    expect(events).toEqual([
      { type: "message", data: "a\nb", lastEventId: "" },
    ]);
  });
  it("drops an event the stream ends before dispatching, per spec", async () => {
    expect(
      await collect(parseSse(stream("data: one\n\n", "data: cut\n"))),
    ).toEqual([{ type: "message", data: "one", lastEventId: "" }]);
    expect(await collect(parseSse(stream("data: cut")))).toEqual([]);
  });
  it("cancels the body when the consumer stops early", async () => {
    let cancelled = false;
    const endless = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    for await (const _ of parseSse(endless)) break;
    expect(cancelled).toBe(true);
  });
  it("skips blocks with no data", async () => {
    expect(await collect(parseSse(stream("event: ping\n\n")))).toEqual([]);
  });
  it("yields nothing for an empty body", async () => {
    expect(await collect(parseSse(new Response(null)))).toEqual([]);
  });
});

describe("parseSse — event IDs and the reconnection time, per spec", () => {
  it("carries the last event ID across events", async () => {
    expect(
      await collect(parseSse(stream("id: 7\ndata: a\n\ndata: b\n\n"))),
    ).toEqual([
      { type: "message", data: "a", id: "7", lastEventId: "7" },
      { type: "message", data: "b", lastEventId: "7" },
    ]);
  });
  it("updates the last event ID from a block without data", async () => {
    expect(await collect(parseSse(stream("id: 3\n\ndata: x\n\n")))).toEqual([
      { type: "message", data: "x", lastEventId: "3" },
    ]);
  });
  it("ignores an id containing NULL", async () => {
    expect(
      await collect(parseSse(stream("id: a\u0000b\ndata: x\n\n"))),
    ).toEqual([{ type: "message", data: "x", lastEventId: "" }]);
  });
  it("takes the retry: field as ASCII digits only", async () => {
    const events = await collect(
      parseSse(
        stream(
          "retry: 0x10\ndata: a\n\nretry: 1e3\ndata: b\n\nretry:\ndata: c\n\n",
        ),
      ),
    );
    expect(events.map((e) => e.reconnectionTime)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
  it("applies a retry: field from a block without data to the events after it", async () => {
    expect(
      await collect(parseSse(stream("retry: 5000\n\ndata: a\n\ndata: b\n\n"))),
    ).toEqual([
      { type: "message", data: "a", lastEventId: "", reconnectionTime: 5000 },
      { type: "message", data: "b", lastEventId: "", reconnectionTime: 5000 },
    ]);
  });
});

describe("parseNdjson", () => {
  it("yields one parsed object per line, skipping blank lines", async () => {
    const out = await collect(
      parseNdjson<{ n: number }>(stream('{"n":1}\n\n{"n', '":2}\n{"n":3}')),
    );
    expect(out).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
  it("rejects on a malformed line", async () => {
    await expect(
      collect(parseNdjson(stream("{oops}\n"))),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("stream limits", () => {
  /** A body that records whether it was cancelled. */
  const tracked = (...chunks: string[]) => {
    const seen = { cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { seen, response: new Response(body) };
  };
  it("rejects a line longer than maxLineLength and cancels the body", async () => {
    const { seen, response } = tracked("a".repeat(30), "a".repeat(30));
    await expect(
      collect(parseNdjson(response, { maxLineLength: 50 })),
    ).rejects.toThrow(/maxLineLength/);
    expect(seen.cancelled).toBe(true);
  });
  it("rejects a long line however the body is chunked", async () => {
    // One chunk holding the whole line and its break.
    await expect(
      collect(
        parseNdjson(stream(`"${"a".repeat(60)}"\n`), { maxLineLength: 50 }),
      ),
    ).rejects.toThrow(/maxLineLength/);
    // The end of a line carried over from the chunk before.
    await expect(
      collect(
        parseNdjson(stream(`"${"a".repeat(40)}`, `${"a".repeat(20)}"\n`), {
          maxLineLength: 50,
        }),
      ),
    ).rejects.toThrow(/maxLineLength/);
    expect(
      await collect(
        parseNdjson(stream(`"${"a".repeat(48)}"\n`), { maxLineLength: 50 }),
      ),
    ).toEqual(["a".repeat(48)]);
  });
  it("decodes a large source chunk in bounded pieces before rejecting a long line", async () => {
    const { seen, response } = tracked("a".repeat(1024 * 1024));
    const decode = vi.spyOn(TextDecoder.prototype, "decode");
    try {
      await expect(
        collect(parseNdjson(response, { maxLineLength: 50 })),
      ).rejects.toThrow(/maxLineLength/);
      const largest = Math.max(
        ...decode.mock.calls.map(([input]) => input?.byteLength ?? 0),
      );
      expect(largest).toBeLessThanOrEqual(64 * 1024);
      expect(seen.cancelled).toBe(true);
    } finally {
      decode.mockRestore();
    }
  });
  it("rejects an SSE event whose data outgrows maxDataLength", async () => {
    const { seen, response } = tracked(
      "data: 0123456789\n",
      "data: 0123456789\n",
      "data: 0123456789\n",
    );
    await expect(
      collect(parseSse(response, { maxDataLength: 25 })),
    ).rejects.toThrow(/maxDataLength/);
    expect(seen.cancelled).toBe(true);
  });
  it("still parses events within the limits", async () => {
    expect(
      await collect(
        parseSse(stream("data: 0123456789\n\n"), {
          maxLineLength: 20,
          maxDataLength: 10,
        }),
      ),
    ).toEqual([{ type: "message", data: "0123456789", lastEventId: "" }]);
  });
  it("keeps a CRLF split over three chunks as one break", async () => {
    expect(
      await collect(parseSse(stream("data: a\r", "\n", "\ndata: b\n\n"))),
    ).toEqual([
      { type: "message", data: "a", lastEventId: "" },
      { type: "message", data: "b", lastEventId: "" },
    ]);
  });
  it("keeps CRLF and UTF-8 characters split across internal decode pieces", async () => {
    const comment = `:${"x".repeat(16 * 1024 - 2)}\r\n`;
    const data = `data: ${"a".repeat(16 * 1024 - 7)}é\n\n`;
    expect(
      await collect(parseSse(stream(comment, data), { maxLineLength: 20_000 })),
    ).toEqual([
      {
        type: "message",
        data: `${"a".repeat(16 * 1024 - 7)}é`,
        lastEventId: "",
      },
    ]);
  });
});
