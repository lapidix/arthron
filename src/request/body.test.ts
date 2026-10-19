import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { canStreamRequestBody, serializeBody } from "./body";

describe("serializeBody", () => {
  it("returns undefined body for undefined", () => {
    expect(serializeBody(undefined, {})).toEqual({
      body: undefined,
      headers: {},
    });
  });
  it("passes raw bodies through without touching headers", () => {
    for (const raw of [
      "text",
      new FormData(),
      new Blob(["x"]),
      new ArrayBuffer(1),
      new Uint8Array(1),
      new URLSearchParams("a=1"),
      new ReadableStream(),
    ]) {
      const out = serializeBody(raw, {});
      expect(out.body).toBe(raw);
      expect(out.headers).toEqual({});
    }
  });
  it("passes raw bodies from another realm or a polyfill through", () => {
    const foreignBuffer = runInNewContext("new ArrayBuffer(2)");
    // formdata-node, fetch-blob and friends identify themselves this way.
    class PolyfillFormData {
      get [Symbol.toStringTag]() {
        return "FormData";
      }
    }
    for (const raw of [foreignBuffer, new PolyfillFormData()]) {
      const out = serializeBody(raw, {});
      expect(out.body).toBe(raw);
      expect(out.headers).toEqual({});
    }
  });
  it("JSON-serializes plain objects and arrays and sets content-type", () => {
    expect(serializeBody({ a: 1 }, {})).toEqual({
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    });
    expect(serializeBody([1], {}).body).toBe("[1]");
  });
  it("does not add content-type when caller already set one (any case)", () => {
    const out = serializeBody(
      { a: 1 },
      { "content-type": "application/vnd.x+json" },
    );
    expect(out.headers).toEqual({ "content-type": "application/vnd.x+json" });
    expect(Object.keys(out.headers)).toHaveLength(1);
  });
  it("serializes null as JSON null", () => {
    expect(serializeBody(null, {}).body).toBe("null");
  });
  it("rejects an object body when content-type is not JSON", () => {
    expect(() =>
      serializeBody(
        { a: 1 },
        { "content-type": "application/x-www-form-urlencoded" },
      ),
    ).toThrow(/URLSearchParams/);
  });
  it("accepts any JSON flavour of content-type", () => {
    for (const type of [
      "application/json; charset=utf-8",
      "application/merge-patch+json",
    ]) {
      expect(serializeBody({ a: 1 }, { "content-type": type }).body).toBe(
        '{"a":1}',
      );
    }
  });
  it("rejects bodies JSON would silently mangle", () => {
    async function* gen() {
      yield 1;
    }
    for (const body of [
      new Map([["a", 1]]),
      new Set([1]),
      gen(),
      Readable.from(["x"]),
      () => 1,
    ]) {
      expect(() => serializeBody(body, {})).toThrow(TypeError);
    }
  });
});

describe("canStreamRequestBody", () => {
  it("is true where Request takes duplex and leaves the stream alone (Node, Chromium)", () => {
    expect(canStreamRequestBody(Request)).toBe(true);
  });
  it("is false where the stream would go out as text (Firefox)", () => {
    // Ignores duplex and stringifies the body, as Firefox does.
    class TextRequest {
      headers = new Headers({ "content-type": "text/plain;charset=UTF-8" });
    }
    expect(canStreamRequestBody(TextRequest as unknown as typeof Request)).toBe(
      false,
    );
  });
  it("is false where Request refuses a stream body", () => {
    class Refusing {
      constructor() {
        throw new TypeError("ReadableStream uploading is not supported");
      }
    }
    expect(canStreamRequestBody(Refusing as unknown as typeof Request)).toBe(
      false,
    );
  });
});
