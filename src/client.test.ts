import { describe, expect, it, vi } from "vitest";
import { arthron } from "./client";
import { ArthronError } from "./error";
import { retry } from "./plugins/retry";
import { fakeFetch, jsonResponse } from "./test-utils";
import type { ArthronConfig, Plugin } from "./types";

const make = (
  fetch = fakeFetch(jsonResponse({ ok: 1 })),
  extra: Partial<ArthronConfig> = {},
) => ({ fetch, api: arthron({ baseURL: "https://a/v1", fetch, ...extra }) });

const headersOf = (init: RequestInit | undefined) =>
  init?.headers as Record<string, string>;

describe("arthron — requests", () => {
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
  it.each(["post", "put", "patch", "query"] as const)(
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
    fd.append("k", "v");
    await api.post("/u", fd);
    // Each attempt gets its own copy, so interceptors never edit the caller's.
    const sent = fetch.calls[0]?.init.body as FormData;
    expect(sent).toBeInstanceOf(FormData);
    expect([...sent]).toEqual([["k", "v"]]);
    expect(headersOf(fetch.calls[0]?.init)["content-type"]).toBeUndefined();
  });
  it("sends a ReadableStream body in a form real fetch accepts", async () => {
    // `new Request` runs the same init checks as fetch, without a network.
    const strict = (async (url: string, init: RequestInit) => {
      new Request(url, init);
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const api = arthron({ baseURL: "https://a", fetch: strict });
    await expect(api.post("/u", new ReadableStream())).resolves.toBeInstanceOf(
      Response,
    );
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

describe("arthron — argument errors reject instead of throwing synchronously", () => {
  it("relative path without baseURL rejects with TypeError", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    await expect(arthron({ fetch }).get("rel")).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fetch.calls).toHaveLength(0);
  });
  it.each(["GET", "HEAD"])(
    "%s with a body rejects with TypeError before fetch",
    async (method) => {
      const { api, fetch } = make();
      await expect(
        api.request("/u", { method, body: { a: 1 } }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(fetch.calls).toHaveLength(0);
    },
  );
  it("with the global fetch, a baseURL without a scheme rejects with TypeError, not status 0", async () => {
    const err = await arthron({ baseURL: "api.example.com" })
      .get("/x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ArthronError);
  });
  it("leaves URL rules to an injected fetch — relative URLs reach one that accepts them", async () => {
    // e.g. SvelteKit's server-side `event.fetch`
    const fetch = fakeFetch(jsonResponse({ ok: 1 }));
    const api = arthron({ baseURL: "/api", fetch });
    expect(await api.get("/items").json()).toEqual({ ok: 1 });
    expect(fetch.calls[0]?.url).toBe("/api/items");
  });
  it("checks the URL an interceptor produced, and does not retry it", async () => {
    let attempts = 0;
    const api = arthron({
      baseURL: "https://a",
      use: [
        retry({ sleep: async () => {} }),
        {
          request: (ctx) => {
            attempts += 1;
            return { ...ctx, url: "::not-a-url" };
          },
        },
      ],
    });
    const err = await api.get("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ArthronError);
    expect(attempts).toBe(1);
  });
  it("unserializable body rejects", async () => {
    const { api, fetch } = make();
    await expect(api.post("/u", { n: 1n })).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("arthron — config", () => {
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
    await arthron({ baseURL: "https://a" }).get("/u");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
  it("resolves globalThis.fetch at call time, so a later global patch is seen", async () => {
    const api = arthron({ baseURL: "https://a" });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ late: true }));
    try {
      expect(await api.get("/u").json()).toEqual({ late: true });
    } finally {
      spy.mockRestore();
    }
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

describe("arthron — errors", () => {
  it("throws ArthronError on !ok with parsed body and custom errorMessage", async () => {
    const { api } = make(
      fakeFetch(jsonResponse({ msg: "bad" }, { status: 422 })),
      {
        errorMessage: (d: unknown) => (d as { msg: string }).msg,
      },
    );
    await expect(api.get("/u")).rejects.toMatchObject({
      name: "ArthronError",
      status: 422,
      message: "bad",
      data: { msg: "bad" },
    });
  });
  it("throws ArthronError status 0 when fetch rejects", async () => {
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
  it("rethrows a custom abort reason raw and skips error interceptors", async () => {
    const reason = new Error("navigated away");
    const ac = new AbortController();
    ac.abort(reason);
    const seen = vi.fn((e: ArthronError) => e);
    const { api } = make(fakeFetch(reason), { use: [{ error: seen }] });
    await expect(api.get("/u", { signal: ac.signal })).rejects.toBe(reason);
    expect(seen).not.toHaveBeenCalled();
  });
  it("error interceptors see the ArthronError", async () => {
    const seen = vi.fn((e: ArthronError) => e);
    const { api } = make(fakeFetch(jsonResponse({}, { status: 500 })), {
      use: [{ error: seen }],
    });
    await expect(api.get("/u")).rejects.toBeInstanceOf(ArthronError);
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("arthron — immutability", () => {
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
    const parent = arthron({ baseURL: "https://a", fetch });
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
    const parent = arthron({
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
    const parent = arthron({ baseURL: "https://a", fetch });
    const child = parent.extend({});
    parent.use(tag("late"));
    await child.get("/u");
    expect(headersOf(fetch.calls[0]?.init)["x-tag"]).toBeUndefined();
  });
});
