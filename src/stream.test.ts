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
      { event: "tick", id: "1", retry: 500, data: "hello" },
      { data: "world" },
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
    expect(events).toEqual([{ data: '{"x":1}' }]);
  });
  it("flushes a trailing event without a final blank line", async () => {
    expect(await collect(parseSse(stream("data: last")))).toEqual([
      { data: "last" },
    ]);
  });
  it("skips blocks with no data", async () => {
    expect(await collect(parseSse(stream("event: ping\n\n")))).toEqual([]);
  });
  it("yields nothing for an empty body", async () => {
    expect(await collect(parseSse(new Response(null)))).toEqual([]);
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
