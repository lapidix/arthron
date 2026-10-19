import { describe, expect, it, vi } from "vitest";
import { arthron } from "./client";
import { ArthronError } from "./error";
import { logging } from "./plugins/logging";
import { retry } from "./plugins/retry";
import { timeout } from "./plugins/timeout";
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
  it("keeps the query out of the URL-check message", async () => {
    const err = await arthron({ baseURL: "api.example.com" })
      .get("/x", { params: { token: "s3cret" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).not.toContain("s3cret");
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
  it("an absolute URL on another origin rejects before fetch", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const api = arthron({ baseURL: "https://api.test/v1", fetch });
    await expect(api.get("https://elsewhere.test/x")).rejects.toBeInstanceOf(
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

describe("arthron — per-call meta", () => {
  it("hands meta to plugins and never sends it to fetch", async () => {
    const seen: unknown[] = [];
    const { api, fetch } = make(undefined, {
      use: [
        {
          middleware: (c, next) => {
            seen.push(c.meta);
            return next(c);
          },
        },
      ],
    });
    await api.get("/u", { meta: { timeout: 5 } });
    expect(seen).toEqual([{ timeout: 5 }]);
    expect("meta" in (fetch.calls[0]?.init ?? {})).toBe(false);
  });
  it("gives every call a meta object, empty when none was passed", async () => {
    const seen: unknown[] = [];
    const { api } = make(undefined, {
      use: [
        {
          request: (c) => {
            seen.push(c.meta);
            return c;
          },
        },
      ],
    });
    await api.get("/u");
    expect(seen).toEqual([{}]);
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
  it("sends config headers to baseURL's origin, absolute or not", async () => {
    const { api, fetch } = make(undefined, {
      headers: { authorization: "Bearer t" },
    });
    await api.get("https://a/elsewhere");
    expect(headersOf(fetch.calls[0]?.init).authorization).toBe("Bearer t");
  });
  it("with allowAbsoluteUrls, another origin gets per-call headers but never config headers", async () => {
    const { api, fetch } = make(undefined, {
      headers: { authorization: "Bearer t" },
      allowAbsoluteUrls: true,
    });
    await api.get("https://b/x", { headers: { "x-call": "1" } });
    expect(fetch.calls[0]?.url).toBe("https://b/x");
    expect(fetch.calls[0]?.init.headers).toEqual({ "x-call": "1" });
  });
  it("drops a default header for one call with null or undefined", async () => {
    const { api, fetch } = make(undefined, {
      headers: { authorization: "Bearer t", "x-tenant": "a" },
    });
    await api.get("/public", {
      headers: { authorization: null, "x-tenant": undefined },
    });
    expect(fetch.calls[0]?.init.headers).toEqual({});
  });
  it("extend() can drop an inherited header with null", async () => {
    const { api, fetch } = make(undefined, {
      headers: { authorization: "Bearer t", accept: "application/json" },
    });
    await api.extend({ headers: { authorization: null } }).get("/u");
    expect(fetch.calls[0]?.init.headers).toEqual({
      accept: "application/json",
    });
  });
  it("leaves content-type to the runtime for FormData, even with a JSON default", async () => {
    const { api, fetch } = make(undefined, {
      headers: { "content-type": "application/json" },
    });
    await api.post("/upload", new FormData());
    expect(headersOf(fetch.calls[0]?.init)["content-type"]).toBeUndefined();
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

describe("arthron — plugins by name", () => {
  /** A middleware that records `label` each time it runs. */
  const mark = (log: string[], label: string, name?: string): Plugin => ({
    ...(name !== undefined && { name }),
    middleware: (c, next) => {
      log.push(label);
      return next(c);
    },
  });
  it("use() replaces a plugin with the same name in place", async () => {
    const log: string[] = [];
    const base = arthron({
      baseURL: "https://a",
      fetch: fakeFetch(jsonResponse({})),
      use: [mark(log, "auth-v1", "auth"), mark(log, "other")],
    });
    await base.use(mark(log, "auth-v2", "auth")).get("/u");
    expect(log).toEqual(["auth-v2", "other"]);
  });
  it("unnamed plugins still append", async () => {
    const log: string[] = [];
    const base = arthron({
      baseURL: "https://a",
      fetch: fakeFetch(jsonResponse({})),
      use: [mark(log, "a")],
    });
    await base.use(mark(log, "b")).get("/u");
    expect(log).toEqual(["a", "b"]);
  });
  it("a second retry() replaces the inherited one instead of multiplying attempts", async () => {
    const fetch = fakeFetch(jsonResponse({}, { status: 503 }));
    const api = arthron({
      baseURL: "https://a",
      fetch,
      use: [retry({ sleep: async () => {} })],
    }).use(retry({ retries: 0 }));
    await expect(api.get("/u")).rejects.toMatchObject({ status: 503 });
    expect(fetch.calls).toHaveLength(1);
  });
  it("a replaced logging() keeps its outer position and logs once per call", async () => {
    const phases: string[] = [];
    const api = arthron({
      baseURL: "https://a",
      fetch: fakeFetch(jsonResponse({}, { status: 503 }), jsonResponse({})),
      use: [logging({ enabled: false }), retry({ sleep: async () => {} })],
    }).use(logging({ onEvent: (e) => phases.push(e.phase) }));
    await api.get("/u");
    expect(phases).toEqual(["start", "success"]);
  });
  it("without() removes plugins by name", async () => {
    // Answers after 30 ms unless its signal aborts first, as fetch would.
    const slow = ((_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(jsonResponse({ ok: 1 })), 30);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(init.signal?.reason);
        });
      })) as unknown as typeof fetch;
    const base = arthron({
      baseURL: "https://a",
      fetch: slow,
      use: [timeout(5)],
    });
    await expect(base.get("/u")).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(await base.without("timeout").get("/u").json()).toEqual({ ok: 1 });
  });
  it("collapses duplicate names in the initial config, last one in the first one's place", async () => {
    const log: string[] = [];
    await arthron({
      baseURL: "https://a",
      fetch: fakeFetch(jsonResponse({})),
      use: [mark(log, "x1", "x"), mark(log, "y"), mark(log, "x2", "x")],
    }).get("/u");
    expect(log).toEqual(["x2", "y"]);
  });
});

describe("arthron — which responses reject", () => {
  it('returns the 3xx of redirect: "manual" instead of rejecting', async () => {
    const { api } = make(
      fakeFetch(
        new Response(null, { status: 302, headers: { location: "/next" } }),
      ),
    );
    const res = await api.get("/u", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/next");
  });
  it("returns an opaque response (mode: \"no-cors\") instead of a status-0 'network' error", async () => {
    const opaque = Object.defineProperties(new Response(null), {
      status: { value: 0 },
      ok: { value: false },
      type: { value: "opaque" },
    });
    const fetch = fakeFetch(opaque);
    const api = arthron({
      baseURL: "https://a/v1",
      fetch,
      use: [retry({ sleep: async () => {} })],
    });
    expect((await api.get("/u", { mode: "no-cors" })).type).toBe("opaque");
    expect(fetch.calls).toHaveLength(1);
  });
  it("throwOn picks which non-ok responses reject", async () => {
    const { api } = make(
      fakeFetch(
        jsonResponse({}, { status: 404 }),
        jsonResponse({}, { status: 500 }),
      ),
      { throwOn: (res) => res.status >= 500 },
    );
    expect((await api.get("/missing")).status).toBe(404);
    await expect(api.get("/broken")).rejects.toMatchObject({ status: 500 });
  });
  it("a per-call throwOn wins over the client's", async () => {
    const { api } = make(fakeFetch(jsonResponse({}, { status: 404 })));
    const res = await api.get("/maybe", { throwOn: () => false });
    expect(res.status).toBe(404);
  });
  it("an ok response never rejects, whatever throwOn says", async () => {
    const { api } = make(fakeFetch(jsonResponse({ ok: 1 })), {
      throwOn: () => true,
    });
    expect(await api.get("/u").json()).toEqual({ ok: 1 });
  });
  it("by default a 404 still rejects", async () => {
    const { api } = make(fakeFetch(jsonResponse({}, { status: 404 })));
    await expect(api.get("/u")).rejects.toMatchObject({ status: 404 });
  });
});
