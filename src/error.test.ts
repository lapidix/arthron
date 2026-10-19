import { describe, expect, it } from "vitest";
import {
  defaultErrorMessage,
  FerruleError,
  isCancellation,
  isFerruleError,
  networkError,
  responseError,
} from "./error";
import { jsonResponse } from "./test-utils";

const req = { url: "https://a/x", init: { method: "GET" } };

describe("defaultErrorMessage", () => {
  it.each([
    [{ message: "m" }, "m"],
    [{ error: "e" }, "e"],
    [{ error: { message: "em" } }, "em"],
    [{ detail: "d" }, "d"],
    [{ message: "1", error: "2", detail: "3" }, "1"],
    [{ details: "not a known key" }, undefined],
    [{ error: { code: 1 } }, undefined],
    ["plain text", undefined],
    [undefined, undefined],
  ])("%j → %j", (data, expected) => {
    expect(defaultErrorMessage(data)).toBe(expected);
  });
});

describe("responseError", () => {
  it("parses JSON body and uses the default message", async () => {
    const err = await responseError(
      jsonResponse({ message: "nope" }, { status: 400, statusText: "Bad" }),
      req,
    );
    expect(err).toBeInstanceOf(FerruleError);
    expect(err.message).toBe("nope");
    expect(err.status).toBe(400);
    expect(err.statusText).toBe("Bad");
    expect(err.data).toEqual({ message: "nope" });
    expect(err.response?.status).toBe(400);
    expect(err.request).toBe(req);
  });
  it("falls back to text when body is not JSON", async () => {
    const err = await responseError(new Response("boom", { status: 502 }), req);
    expect(err.data).toBe("boom");
    expect(err.message).toBe("Request failed with status 502");
  });
  it("leaves data undefined for an empty body", async () => {
    const err = await responseError(new Response(null, { status: 404 }), req);
    expect(err.data).toBeUndefined();
  });
  it("uses a custom resolver and falls back when it returns undefined", async () => {
    const custom = await responseError(
      jsonResponse({ msg: "c" }, { status: 400 }),
      req,
      (d) => (d as { msg: string }).msg,
    );
    expect(custom.message).toBe("c");
    const fallback = await responseError(
      jsonResponse({ msg: "c" }, { status: 400 }),
      req,
      () => undefined,
    );
    expect(fallback.message).toBe("Request failed with status 400");
  });
});

describe("networkError", () => {
  it("normalizes to status 0 with the cause attached", () => {
    const cause = new TypeError("fetch failed");
    const err = networkError(cause, req);
    expect(err.status).toBe(0);
    expect(err.message).toBe("fetch failed");
    expect(err.cause).toBe(cause);
    expect(err.response).toBeUndefined();
    expect([...err.headers]).toEqual([]);
  });
  it("uses a generic message when cause has none", () => {
    expect(networkError("x", req).message).toBe("Network error");
  });
});

describe("guards", () => {
  it("isFerruleError", () => {
    expect(isFerruleError(networkError(new Error("x"), req))).toBe(true);
    expect(isFerruleError(new Error("x"))).toBe(false);
  });
  it("isCancellation matches AbortError and TimeoutError by name", () => {
    expect(isCancellation(new DOMException("a", "AbortError"))).toBe(true);
    expect(isCancellation(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isCancellation(new Error("x"))).toBe(false);
  });
});
