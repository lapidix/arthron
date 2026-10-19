import { describe, expect, it } from "vitest";
import { toFerrulePromise } from "./promise";
import { jsonResponse } from "./test-utils";

describe("toFerrulePromise", () => {
  it("awaits to the raw Response", async () => {
    const res = await toFerrulePromise(Promise.resolve(jsonResponse({ a: 1 })));
    expect(res).toBeInstanceOf(Response);
  });
  it(".json<T>() returns the parsed body", async () => {
    expect(
      await toFerrulePromise(Promise.resolve(jsonResponse({ a: 1 }))).json<{
        a: number;
      }>(),
    ).toEqual({ a: 1 });
  });
  it(".text() / .blob() / .arrayBuffer() / .formData() delegate to Response", async () => {
    expect(
      await toFerrulePromise(Promise.resolve(new Response("hi"))).text(),
    ).toBe("hi");
    expect(
      (await toFerrulePromise(Promise.resolve(new Response("hi"))).blob()).size,
    ).toBe(2);
    expect(
      (
        await toFerrulePromise(
          Promise.resolve(new Response("hi")),
        ).arrayBuffer()
      ).byteLength,
    ).toBe(2);
    const fd = new FormData();
    fd.append("k", "v");
    expect(
      (
        await toFerrulePromise(Promise.resolve(new Response(fd))).formData()
      ).get("k"),
    ).toBe("v");
  });
  it(".json() rejects on an empty 204 body (does not hide it)", async () => {
    await expect(
      toFerrulePromise(
        Promise.resolve(new Response(null, { status: 204 })),
      ).json(),
    ).rejects.toThrow();
  });
  it("rejection propagates through the chain", async () => {
    await expect(
      toFerrulePromise(Promise.reject(new Error("x"))).json(),
    ).rejects.toThrow("x");
  });
});
