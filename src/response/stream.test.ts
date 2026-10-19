import { describe, expect, it } from "vitest";
import { parseNdjson, parseSse } from "./stream";

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
  it("dispatches one event per blank line with data/event/id/retry", async () => {
    const events = await collect(
      parseSse(
        stream(
          "event: tick\nid: 1\nretry: 500\ndata: hello\n\n",
          "data: world\n\n",
        ),
      ),
    );
    expect(events).toEqual([
      { event: "tick", id: "1", lastEventId: "1", retry: 500, data: "hello" },
      // id and retry are stream state: they carry on to the next event.
      { data: "world", lastEventId: "1", retry: 500 },
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
    expect(events).toEqual([{ data: '{"x":1}', lastEventId: "" }]);
  });
  it("treats a CRLF split across two chunks as one line break", async () => {
    const events = await collect(
      parseSse(stream("data: a\r", "\ndata: b\r\n\r\n")),
    );
    expect(events).toEqual([{ data: "a\nb", lastEventId: "" }]);
  });
  it("drops an event the stream ends before dispatching, per spec", async () => {
    expect(
      await collect(parseSse(stream("data: one\n\n", "data: cut\n"))),
    ).toEqual([{ data: "one", lastEventId: "" }]);
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

describe("parseSse — event IDs and retry, per spec", () => {
  it("carries the last event ID across events", async () => {
    expect(
      await collect(parseSse(stream("id: 7\ndata: a\n\ndata: b\n\n"))),
    ).toEqual([
      { data: "a", id: "7", lastEventId: "7" },
      { data: "b", lastEventId: "7" },
    ]);
  });
  it("updates the last event ID from a block without data", async () => {
    expect(await collect(parseSse(stream("id: 3\n\ndata: x\n\n")))).toEqual([
      { data: "x", lastEventId: "3" },
    ]);
  });
  it("ignores an id containing NULL", async () => {
    expect(
      await collect(parseSse(stream("id: a\u0000b\ndata: x\n\n"))),
    ).toEqual([{ data: "x", lastEventId: "" }]);
  });
  it("accepts retry as ASCII digits only", async () => {
    const events = await collect(
      parseSse(
        stream(
          "retry: 0x10\ndata: a\n\nretry: 1e3\ndata: b\n\nretry:\ndata: c\n\n",
        ),
      ),
    );
    expect(events.map((e) => e.retry)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
  it("applies a retry from a block without data to the events after it", async () => {
    expect(
      await collect(parseSse(stream("retry: 5000\n\ndata: a\n\ndata: b\n\n"))),
    ).toEqual([
      { data: "a", lastEventId: "", retry: 5000 },
      { data: "b", lastEventId: "", retry: 5000 },
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
  it("rejects an SSE event whose data outgrows maxEventSize", async () => {
    const { seen, response } = tracked(
      "data: 0123456789\n",
      "data: 0123456789\n",
      "data: 0123456789\n",
    );
    await expect(
      collect(parseSse(response, { maxEventSize: 25 })),
    ).rejects.toThrow(/maxEventSize/);
    expect(seen.cancelled).toBe(true);
  });
  it("still parses events within the limits", async () => {
    expect(
      await collect(
        parseSse(stream("data: 0123456789\n\n"), {
          maxLineLength: 20,
          maxEventSize: 10,
        }),
      ),
    ).toEqual([{ data: "0123456789", lastEventId: "" }]);
  });
  it("keeps a CRLF split over three chunks as one break", async () => {
    expect(
      await collect(parseSse(stream("data: a\r", "\n", "\ndata: b\n\n"))),
    ).toEqual([
      { data: "a", lastEventId: "" },
      { data: "b", lastEventId: "" },
    ]);
  });
});
