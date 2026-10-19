import { describe, expect, it } from "vitest";
import { jsonResponse } from "../testkit/fetch.testkit";
import { ArthronError } from "./arthron-error";
import {
  defaultErrorMessage,
  isCancellation,
  networkError,
  responseError,
} from "./create-error";

const req = {
  url: "https://a/x",
  init: { method: "GET", headers: {} },
  meta: {},
};

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
    expect(err).toBeInstanceOf(ArthronError);
    expect(err.message).toBe("nope");
    expect(err.status).toBe(400);
    expect(err.statusText).toBe("Bad");
    expect(err.data).toEqual({ message: "nope" });
    expect(err.response?.status).toBe(400);
    expect(err.request).toBe(req);
  });
  it("leaves error.response readable", async () => {
    const err = await responseError(
      jsonResponse({ message: "nope" }, { status: 400 }),
      req,
    );
    expect(err.response?.bodyUsed).toBe(false);
    expect(await err.response?.json()).toEqual({ message: "nope" });
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

describe("isCancellation", () => {
  it("isCancellation matches AbortError and TimeoutError by name", () => {
    expect(isCancellation(new DOMException("a", "AbortError"))).toBe(true);
    expect(isCancellation(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isCancellation(new Error("x"))).toBe(false);
  });
});

describe("responseError reads at most 64 KiB of the body", () => {
  const LIMIT = 64 * 1024;
  /** A body of `total` bytes of "a", produced lazily; records how much was pulled and whether it was cancelled. */
  const source = (total: number) => {
    const seen = { pulled: 0, cancelled: false };
    const chunk = new Uint8Array(16 * 1024).fill(97);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Yield like a real socket would, so timers (and test timeouts) still run.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (seen.pulled >= total) return controller.close();
        seen.pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { seen, response: new Response(body, { status: 500 }) };
  };
  it("keeps the first 64 KiB as text, cancels the rest unread", async () => {
    const { seen, response } = source(10 * 1024 * 1024);
    const err = await responseError(response, req);
    expect(typeof err.data).toBe("string");
    expect((err.data as string).length).toBe(LIMIT);
    expect(seen.cancelled).toBe(true);
    expect(seen.pulled).toBeLessThanOrEqual(LIMIT + 16 * 1024);
  });
  it("settles on a body that never ends", { timeout: 2000 }, async () => {
    const { seen, response } = source(Number.POSITIVE_INFINITY);
    const err = await responseError(response, req);
    expect(err.status).toBe(500);
    expect(seen.cancelled).toBe(true);
  });
  it("leaves error.response readable with what was read, keeping url and redirected", async () => {
    const original = Object.defineProperties(
      jsonResponse({ message: "nope" }, { status: 404 }),
      { url: { value: "https://a/x" }, redirected: { value: true } },
    );
    const err = await responseError(original, req);
    expect(err.response?.url).toBe("https://a/x");
    expect(err.response?.redirected).toBe(true);
    expect(await err.response?.json()).toEqual({ message: "nope" });
  });
});
