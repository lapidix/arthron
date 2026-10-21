import { describe, expect, it } from "vitest";
import { jsonResponse } from "../testkit/fetch.testkit";
import { ArthronError } from "./arthron-error";
import {
  defaultDescription,
  isCancellation,
  networkError,
  responseError,
} from "./create-error";

const req = {
  url: "https://a/x",
  init: { method: "GET", headers: {} },
  meta: {},
};

describe("defaultDescription", () => {
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
    expect(defaultDescription(data)).toBe(expected);
  });
});

describe("responseError", () => {
  it("writes its own message and keeps the server's text in description", async () => {
    const err = await responseError(
      jsonResponse({ message: "nope" }, { status: 400, statusText: "Bad" }),
      req,
    );
    expect(err).toBeInstanceOf(ArthronError);
    expect(err.message).toBe("GET https://a/x failed with 400 Bad");
    expect(err.description).toBe("nope");
    expect(err.status).toBe(400);
    expect(err.statusText).toBe("Bad");
    expect(err.payload).toEqual({ message: "nope" });
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
  it("uses the status alone when there is no status text (HTTP/2), and no description for a plain body", async () => {
    const err = await responseError(new Response("boom", { status: 502 }), req);
    expect(err.payload).toBe("boom");
    expect(err.message).toBe("GET https://a/x failed with 502");
    expect(err.description).toBeUndefined();
  });
  it("leaves data undefined for an empty body", async () => {
    const err = await responseError(new Response(null, { status: 404 }), req);
    expect(err.payload).toBeUndefined();
  });
  it("fills description from a custom extractDescription, or leaves it undefined", async () => {
    const custom = await responseError(
      jsonResponse({ msg: "c" }, { status: 400 }),
      req,
      (d) => (d as { msg: string }).msg,
    );
    expect(custom.description).toBe("c");
    expect(custom.message).toBe("GET https://a/x failed with 400");
    const none = await responseError(
      jsonResponse({ msg: "c" }, { status: 400 }),
      req,
      () => undefined,
    );
    expect(none.description).toBeUndefined();
  });
  it("keeps the query, userinfo and the server's text out of the message", async () => {
    const err = await responseError(
      jsonResponse(
        { message: "Cannot POST /internal/admin\r\nX-Fake: 1" },
        { status: 404 },
      ),
      {
        url: "https://u:pw@a/x?token=s3cret",
        init: { method: "POST", headers: {} },
        meta: {},
      },
    );
    expect(err.message).toBe("POST https://a/x failed with 404");
    expect(err.description).toBe("Cannot POST /internal/admin\r\nX-Fake: 1");
  });
});

describe("networkError", () => {
  it("normalizes to status 0, names the request and the cause", () => {
    const cause = new TypeError("fetch failed");
    const err = networkError(cause, req);
    expect(err.status).toBe(0);
    expect(err.message).toBe("GET https://a/x failed: fetch failed");
    expect(err.description).toBeUndefined();
    expect(err.cause).toBe(cause);
    expect(err.response).toBeUndefined();
    expect([...err.headers]).toEqual([]);
  });
  it("says network error when the cause has no message", () => {
    expect(networkError("x", req).message).toBe(
      "GET https://a/x failed: network error",
    );
  });
  it("keeps the query and userinfo out when the runtime's message names the URL", () => {
    // Deno, for one: "error sending request for url (…)".
    const url = "https://u:pw@a/x?token=s3cret";
    const err = networkError(
      new TypeError(`error sending request for url (${url})`),
      { url, init: { method: "GET", headers: {} }, meta: {} },
    );
    expect(err.message).toBe(
      "GET https://a/x failed: error sending request for url (https://a/x)",
    );
    expect(JSON.stringify(err)).not.toContain("s3cret");
  });
  it("says why a ReadableStream body fails in a browser and what to send instead", () => {
    const streaming = {
      ...req,
      init: { method: "POST", headers: {}, body: new ReadableStream() },
    };
    expect(
      networkError(new TypeError("Failed to fetch"), streaming).message,
    ).toBe(
      "POST https://a/x failed: Failed to fetch — in a browser, a ReadableStream body streams only over HTTP/2; send a Blob or ArrayBuffer to an HTTP/1.1 server",
    );
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
    expect(typeof err.payload).toBe("string");
    expect((err.payload as string).length).toBe(LIMIT);
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
