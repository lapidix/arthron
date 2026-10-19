import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  ArthronError,
  defaultErrorMessage,
  isArthronError,
  isCancellation,
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
    expect(err).toBeInstanceOf(ArthronError);
    expect(err.message).toBe("nope");
    expect(err.status).toBe(400);
    expect(err.statusText).toBe("Bad");
    expect(err.data).toEqual({ message: "nope" });
    expect(err.response?.status).toBe(400);
    expect(err.request).toBe(req);
  });
  it("keeps the original response readable (body is read from a clone)", async () => {
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

describe("guards", () => {
  it("isArthronError", () => {
    expect(isArthronError(networkError(new Error("x"), req))).toBe(true);
    expect(isArthronError(new Error("x"))).toBe(false);
  });
  it("isCancellation matches AbortError and TimeoutError by name", () => {
    expect(isCancellation(new DOMException("a", "AbortError"))).toBe(true);
    expect(isCancellation(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isCancellation(new Error("x"))).toBe(false);
  });
});

describe("ArthronError keeps request secrets out of serialization", () => {
  const SECRETS = ["Q-SECRET", "H-SECRET", "B-SECRET", "R-SECRET"];
  const make = () =>
    responseError(
      jsonResponse(
        { message: "nope" },
        { status: 401, headers: { "x-session": "R-SECRET" } },
      ),
      {
        url: "https://user:pw@api.test/login?api_key=Q-SECRET",
        init: {
          method: "POST",
          headers: { authorization: "Bearer H-SECRET" },
          body: '{"password":"B-SECRET"}',
        },
      },
    );
  it("JSON.stringify gives status, message, method and a redacted url — no secrets", async () => {
    const json = JSON.stringify(await make());
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).not.toContain("pw@");
    expect(JSON.parse(json)).toMatchObject({
      name: "ArthronError",
      message: "nope",
      status: 401,
      method: "POST",
      url: "https://api.test/login",
    });
  });
  it("util.inspect (console.error) shows no secrets", async () => {
    const text = inspect(await make(), { depth: 10 });
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
  it("still hands request, response and headers to code that asks for them", async () => {
    const err = await make();
    expect(err.request.init.headers).toEqual({
      authorization: "Bearer H-SECRET",
    });
    expect(err.headers.get("x-session")).toBe("R-SECRET");
    expect(err.response?.status).toBe(401);
  });
});
