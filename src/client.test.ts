import { describe, expect, it, vi } from "vitest";
import { ferrule } from "./client";
import { FerruleError } from "./error";
import { fakeFetch, jsonResponse } from "./test-utils";
import type { FerruleConfig, Plugin } from "./types";

const make = (
  fetch = fakeFetch(jsonResponse({ ok: 1 })),
  extra: Partial<FerruleConfig> = {},
) => ({ fetch, api: ferrule({ baseURL: "https://a/v1", fetch, ...extra }) });

const headersOf = (init: RequestInit | undefined) =>
  init?.headers as Record<string, string>;

describe("ferrule — requests", () => {
  it("get sends GET to baseURL + path with params and returns the Response", async () => {
    const { api, fetch } = make();
    const res = await api.get("/u", { params: { q: 1 } });
    expect(res).toBeInstanceOf(Response);
    expect(fetch.calls[0]).toMatchObject({
      url: "https://a/v1/u?q=1",
      init: { method: "GET" },
    });
  });
  it(".json<T>() works on the client promise", async () => {
    const { api } = make();
    expect(await api.get("/u").json<{ ok: number }>()).toEqual({ ok: 1 });
  });
  it.each(["post", "put", "patch"] as const)(
    "%s JSON-serializes object bodies",
    async (m) => {
      const { api, fetch } = make();
      await api[m]("/u", { a: 1 });
      expect(fetch.calls[0]?.init).toMatchObject({
        method: m.toUpperCase(),
        body: '{"a":1}',
        headers: { "content-type": "application/json" },
      });
    },
  );
  it("post passes FormData through without content-type", async () => {
    const { api, fetch } = make();
    const fd = new FormData();
    await api.post("/u", fd);
    expect(fetch.calls[0]?.init.body).toBe(fd);
    expect(headersOf(fetch.calls[0]?.init)["content-type"]).toBeUndefined();
  });
  it("delete and head send without body", async () => {
    const { api, fetch } = make();
    await api.delete("/u");
    await api.head("/u");
    expect(fetch.calls.map((c) => c.init.method)).toEqual(["DELETE", "HEAD"]);
    expect(fetch.calls.every((c) => c.init.body === undefined)).toBe(true);
  });
  it("request() sends an arbitrary method with the same body rules", async () => {
    const { api, fetch } = make();
    await api.request("/u", { method: "OPTIONS", body: { a: 1 } });
    expect(fetch.calls[0]?.init).toMatchObject({
      method: "OPTIONS",
      body: '{"a":1}',
    });
  });
  it("request() without method rejects with TypeError before calling fetch", async () => {
    const { api, fetch } = make();
    // @ts-expect-error — method is required
    await expect(api.request("/u", {})).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("ferrule — argument errors reject instead of throwing synchronously", () => {
  it("relative path without baseURL rejects with TypeError", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    await expect(ferrule({ fetch }).get("rel")).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fetch.calls).toHaveLength(0);
  });
  it("unserializable body rejects", async () => {
    const { api, fetch } = make();
    await expect(api.post("/u", { n: 1n })).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("ferrule — config", () => {
  it("merges default headers under per-call headers, case-insensitively", async () => {
    const { api, fetch } = make(undefined, {
      headers: { "X-A": "base", "X-B": "base" },
    });
    await api.get("/u", { headers: { "x-a": "call" } });
    expect(fetch.calls[0]?.init.headers).toEqual({
      "x-a": "call",
      "x-b": "base",
    });
  });
  it("does not set credentials unless configured", async () => {
    const { api, fetch } = make();
    await api.get("/u");
    expect("credentials" in (fetch.calls[0]?.init ?? {})).toBe(false);
  });
  it("forwards configured credentials", async () => {
    const { api, fetch } = make(undefined, { credentials: "include" });
    await api.get("/u");
    expect(fetch.calls[0]?.init.credentials).toBe("include");
  });
  it("lets a per-call credentials override the configured default", async () => {
    const { api, fetch } = make(undefined, { credentials: "include" });
    await api.get("/u", { credentials: "omit" });
    expect(fetch.calls[0]?.init.credentials).toBe("omit");
  });
  it("uses globalThis.fetch when none injected", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({}));
    await ferrule({ baseURL: "https://a" }).get("/u");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
  it("passes signal and other RequestInit through", async () => {
    const { api, fetch } = make();
    const ac = new AbortController();
    await api.get("/u", { signal: ac.signal, cache: "no-store" });
    expect(fetch.calls[0]?.init).toMatchObject({
      signal: ac.signal,
      cache: "no-store",
    });
  });
});

describe("ferrule — errors", () => {
  it("throws FerruleError on !ok with parsed body and custom errorMessage", async () => {
    const { api } = make(
      fakeFetch(jsonResponse({ msg: "bad" }, { status: 422 })),
      {
        errorMessage: (d: unknown) => (d as { msg: string }).msg,
      },
    );
    await expect(api.get("/u")).rejects.toMatchObject({
      name: "FerruleError",
      status: 422,
      message: "bad",
      data: { msg: "bad" },
    });
  });
  it("throws FerruleError status 0 when fetch rejects", async () => {
    const { api } = make(fakeFetch(new TypeError("fetch failed")));
    await expect(api.get("/u")).rejects.toMatchObject({
      status: 0,
      message: "fetch failed",
    });
  });
  it("rethrows AbortError raw when fetch rejects with it", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const { api } = make(fakeFetch(abort));
    await expect(api.get("/u")).rejects.toBe(abort);
  });
  it("error interceptors see the FerruleError", async () => {
    const seen = vi.fn((e: FerruleError) => e);
    const { api } = make(fakeFetch(jsonResponse({}, { status: 500 })), {
      use: [{ error: seen }],
    });
    await expect(api.get("/u")).rejects.toBeInstanceOf(FerruleError);
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("ferrule — immutability", () => {
  const tag = (v: string): Plugin => ({
    request: (c) => ({
      ...c,
      init: {
        ...c.init,
        headers: { ...(c.init.headers as object), "x-tag": v },
      },
    }),
  });

  it("use() returns a new client and leaves the parent untouched", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const parent = ferrule({ baseURL: "https://a", fetch });
    const child = parent.use(tag("child"));
    expect(child).not.toBe(parent);
    await parent.get("/u");
    await child.get("/u");
    expect(fetch.calls.map((c) => headersOf(c.init)["x-tag"])).toEqual([
      undefined,
      "child",
    ]);
  });
  it("extend() appends plugins, merges headers (child wins), keeps parent config otherwise", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const parent = ferrule({
      baseURL: "https://a/v1",
      fetch,
      headers: { "X-A": "p", "X-B": "p" },
      use: [tag("p")],
    });
    const child = parent.extend({ headers: { "x-a": "c" }, use: [tag("c")] });
    await child.get("/u");
    expect(fetch.calls[0]?.url).toBe("https://a/v1/u");
    expect(fetch.calls[0]?.init.headers).toMatchObject({
      "x-a": "c",
      "x-b": "p",
      "x-tag": "c",
    });
  });
  it("adding to the parent after extend does not affect the child", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const parent = ferrule({ baseURL: "https://a", fetch });
    const child = parent.extend({});
    parent.use(tag("late"));
    await child.get("/u");
    expect(headersOf(fetch.calls[0]?.init)["x-tag"]).toBeUndefined();
  });
});
