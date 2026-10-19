import { describe, expect, it } from "vitest";
import { toArthronPromise } from "./promise";
import { jsonResponse } from "./test-utils";

describe("toArthronPromise", () => {
  it("awaits to the raw Response", async () => {
    const res = await toArthronPromise(Promise.resolve(jsonResponse({ a: 1 })));
    expect(res).toBeInstanceOf(Response);
  });
  it(".json<T>() returns the parsed body", async () => {
    expect(
      await toArthronPromise(Promise.resolve(jsonResponse({ a: 1 }))).json<{
        a: number;
      }>(),
    ).toEqual({ a: 1 });
  });
  it(".text() / .blob() / .arrayBuffer() / .formData() delegate to Response", async () => {
    expect(
      await toArthronPromise(Promise.resolve(new Response("hi"))).text(),
    ).toBe("hi");
    expect(
      (await toArthronPromise(Promise.resolve(new Response("hi"))).blob()).size,
    ).toBe(2);
    expect(
      (
        await toArthronPromise(
          Promise.resolve(new Response("hi")),
        ).arrayBuffer()
      ).byteLength,
    ).toBe(2);
    const fd = new FormData();
    fd.append("k", "v");
    expect(
      (
        await toArthronPromise(Promise.resolve(new Response(fd))).formData()
      ).get("k"),
    ).toBe("v");
  });
  it(".json() rejects on an empty 204 body (does not hide it)", async () => {
    await expect(
      toArthronPromise(
        Promise.resolve(new Response(null, { status: 204 })),
      ).json(),
    ).rejects.toThrow();
  });
  it(".sse() and .ndjson() stream the body", async () => {
    const body = (text: string) => Promise.resolve(new Response(text));
    const sse: unknown[] = [];
    for await (const e of toArthronPromise(
      body("data: a\n\ndata: b\n\n"),
    ).sse())
      sse.push(e);
    expect(sse).toEqual([
      { data: "a", lastEventId: "" },
      { data: "b", lastEventId: "" },
    ]);
    const rows: unknown[] = [];
    for await (const r of toArthronPromise(body('{"a":1}\n{"a":2}\n')).ndjson<{
      a: number;
    }>())
      rows.push(r);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it(".sse() created now and iterated later leaves no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const boom = new Error("boom");
      const events = toArthronPromise(Promise.reject(boom)).sse();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      const iterate = async () => {
        for await (const _ of events);
      };
      await expect(iterate()).rejects.toBe(boom);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
  it("rejection propagates through the chain", async () => {
    await expect(
      toArthronPromise(Promise.reject(new Error("x"))).json(),
    ).rejects.toThrow("x");
  });
});
