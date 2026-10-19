import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { serializeBody } from "./body";

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
});
