import { describe, expect, it, vi } from "vitest";
import { ArthronError } from "../error/arthron-error";
import { logging } from "../plugins/logging/logging";
import { retry, retryWith } from "../plugins/retry/retry";
import { timeout } from "../plugins/timeout/timeout";
import { fakeFetch, jsonResponse } from "../testkit/fetch.testkit";
import type { Plugin } from "../types/plugin.types";
import { arthron } from "./client";
import type { ArthronClientOptions, RequestOptions } from "./client.types";

// Public types are interfaces, so a plugin package can extend them.
declare module "./client.types" {
  interface RequestOptions {
    traceName?: string;
  }
}

const make = (
  fetch = fakeFetch(jsonResponse({ ok: 1 })),
  extra: Partial<ArthronClientOptions> = {},
) => ({
  fetch,
  api: arthron({ baseURL: "https://a/v1", fetchFn: fetch, ...extra }),
});

const headersOf = (init: RequestInit | undefined) =>
  init?.headers as Record<string, string>;

describe("arthron — requests", () => {
  it("get sends GET to baseURL + path with params and returns the Response", async () => {
    const { api, fetch } = make();
    const res = await api.get("/u", { queryParams: { q: 1 } });
    expect(res).toBeInstanceOf(Response);
    expect(fetch.calls[0]).toMatchObject({
      url: "https://a/v1/u?q=1",
      init: { method: "GET" },
    });
  });
  it("sends array params as repeated keys and takes URLSearchParams", async () => {
    const { api, fetch } = make();
    await api.get("/u", { queryParams: { ids: [1, 2] } });
    await api.get("/u", { queryParams: new URLSearchParams("a=1&a=2") });
    expect(fetch.calls.map((c) => c.url)).toEqual([
      "https://a/v1/u?ids=1&ids=2",
      "https://a/v1/u?a=1&a=2",
    ]);
  });
  it("fills {placeholders} from path, encoded", async () => {
    const { api, fetch } = make();
    await api.get("/users/{id}/posts", { pathParams: { id: "a b/c" } });
    expect(fetch.calls[0]?.url).toBe("https://a/v1/users/a%20b%2Fc/posts");
  });
  it("leaves braces alone when no path values are given", async () => {
    const { api, fetch } = make();
    await api.get("/literal/{x}");
    expect(fetch.calls[0]?.url).toBe("https://a/v1/literal/{x}");
  });
  it("rejects a dot segment in path values before fetch", async () => {
    const { api, fetch } = make();
    await expect(
      api.get("/users/{id}", { pathParams: { id: ".." } }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
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
    const api = arthron({ baseURL: "https://a", fetchFn: strict });
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
  it.each([
    ["patch", "PATCH"],
    ["query", "QUERY"],
    ["delete", "DELETE"],
  ])("request() sends a standard method %s as %s", async (given, sent) => {
    const { api, fetch } = make();
    await api.request("/u", { method: given });
    expect(fetch.calls[0]?.init.method).toBe(sent);
  });
  it("request() keeps a non-standard method as written", async () => {
    const { api, fetch } = make();
    await api.request("/u", { method: "Purge" });
    expect(fetch.calls[0]?.init.method).toBe("Purge");
  });
  it("accepts options a plugin added to RequestOptions by augmentation", async () => {
    const { api, fetch } = make();
    await api.get("/u", { traceName: "checkout" });
    expect(fetch.calls).toHaveLength(1);
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
    await expect(arthron({ fetchFn: fetch }).get("rel")).rejects.toBeInstanceOf(
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
      .get("/x", { queryParams: { token: "s3cret" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).not.toContain("s3cret");
  });
  it("leaves URL rules to an injected fetch — relative URLs reach one that accepts them", async () => {
    // e.g. SvelteKit's server-side `event.fetch`
    const fetch = fakeFetch(jsonResponse({ ok: 1 }));
    const api = arthron({ baseURL: "/api", fetchFn: fetch });
    expect(await api.get("/items").json()).toEqual({ ok: 1 });
    expect(fetch.calls[0]?.url).toBe("/api/items");
  });
  it("checks the URL an interceptor produced, and does not retry it", async () => {
    let attempts = 0;
    const api = arthron({
      baseURL: "https://a",
      plugins: [
        retryWith({}, async () => {}),
        {
          transformRequest: (ctx) => {
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
    const api = arthron({ baseURL: "https://api.test/v1", fetchFn: fetch });
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
      plugins: [
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
      plugins: [
        {
          transformRequest: (c) => {
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
  it("to an origin in allowedOrigins, sends per-call headers but never config headers", async () => {
    const { api, fetch } = make(undefined, {
      headers: { authorization: "Bearer t" },
      allowedOrigins: ["https://b"],
    });
    await api.get("https://b/x", { headers: { "x-call": "1" } });
    expect(fetch.calls[0]?.url).toBe("https://b/x");
    expect(fetch.calls[0]?.init.headers).toEqual({ "x-call": "1" });
  });
  it("counts only the origin of an allowedOrigins URL", async () => {
    const { api, fetch } = make(undefined, {
      allowedOrigins: ["https://b/any/path"],
    });
    await api.get("https://b/x");
    expect(fetch.calls[0]?.url).toBe("https://b/x");
    await expect(api.get("http://b/x")).rejects.toThrow(TypeError);
  });
  it("refuses allowedOrigins that are empty or not http(s) URLs when the client is created", () => {
    expect(() => arthron({ allowedOrigins: [] })).toThrow(
      /allowedOrigins needs at least one URL/,
    );
    expect(() => arthron({ allowedOrigins: ["cdn.test"] })).toThrow(
      /allowedOrigins needs http\(s\) URLs, got "cdn.test"/,
    );
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
  it("sends any fetch option set in config as a default", async () => {
    const { api, fetch } = make(undefined, {
      cache: "no-store",
      redirect: "error",
      mode: "cors",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
    await api.get("/u");
    expect(fetch.calls[0]?.init).toMatchObject({
      cache: "no-store",
      redirect: "error",
      mode: "cors",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  });
  it("lets a per-call fetch option win over the config default", async () => {
    const { api, fetch } = make(undefined, { cache: "no-store" });
    await api.get("/u", { cache: "reload" });
    expect(fetch.calls[0]?.init.cache).toBe("reload");
  });
  it("extend() overrides a fetch default and keeps the others", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const parent = arthron({
      baseURL: "https://a",
      fetchFn: fetch,
      cache: "no-store",
      redirect: "error",
    });
    await parent.extend({ cache: "force-cache" }).get("/u");
    expect(fetch.calls[0]?.init).toMatchObject({
      cache: "force-cache",
      redirect: "error",
    });
  });
  it("sends no fetch option it was not given", async () => {
    const { api, fetch } = make();
    await api.get("/u");
    expect(Object.keys(fetch.calls[0]?.init ?? {}).sort()).toEqual([
      "headers",
      "method",
    ]);
  });
  it.each(["signal", "body", "method"])(
    "refuses %s as a client default, at construction",
    (key) => {
      expect(() =>
        arthron({ baseURL: "https://a", [key]: "x" } as ArthronClientOptions),
      ).toThrow(new RegExp(`${key}.*per call`));
    },
  );
  it("does not type signal, body or method as config", () => {
    // Type-checked, never run: these would throw at construction.
    const typeOnly = () => {
      // @ts-expect-error — a client-wide signal would abort every later call
      arthron({ signal: new AbortController().signal });
      // @ts-expect-error — body is per call
      arthron({ body: "x" });
    };
    expect(typeOnly).toBeTypeOf("function");
  });
  it("never sends arthron's own config keys to fetch", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    await arthron({
      baseURL: "https://a",
      allowedOrigins: ["https://b"],
      headers: { a: "1" },
      fetchFn: fetch,
      plugins: [],
      serverMessageFn: () => undefined,
      throwOn: () => true,
    }).get("/u");
    expect(Object.keys(fetch.calls[0]?.init ?? {}).sort()).toEqual([
      "headers",
      "method",
    ]);
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
  it("throws ArthronError on !ok with parsed body and custom serverMessageFn", async () => {
    const { api } = make(
      fakeFetch(jsonResponse({ msg: "bad" }, { status: 422 })),
      {
        serverMessageFn: (body: unknown) => (body as { msg: string }).msg,
      },
    );
    await expect(api.get("/u")).rejects.toMatchObject({
      name: "ArthronError",
      status: 422,
      message: "GET https://a/v1/u failed with 422",
      serverMessage: "bad",
      data: { msg: "bad" },
    });
  });
  it("throws ArthronError status 0 when fetch rejects", async () => {
    const { api } = make(fakeFetch(new TypeError("fetch failed")));
    await expect(api.get("/u")).rejects.toMatchObject({
      status: 0,
      message: "GET https://a/v1/u failed: fetch failed",
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
    const { api } = make(fakeFetch(reason), {
      plugins: [{ transformError: seen }],
    });
    await expect(api.get("/u", { signal: ac.signal })).rejects.toBe(reason);
    expect(seen).not.toHaveBeenCalled();
  });

  describe("with a fetch that drops the abort reason, as WebKit's does", () => {
    const dropped = () =>
      new DOMException("The operation was aborted.", "AbortError");
    // Waits for its signal, then rejects — or errors a half-sent body — with
    // a generic AbortError instead of signal.reason.
    const webkitFetch = (body?: string) =>
      (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
        if (body === undefined) {
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(dropped()));
          });
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            init.signal?.addEventListener("abort", () =>
              controller.error(dropped()),
            );
          },
        });
        return new Response(stream, {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
    const client = (
      fetch: typeof globalThis.fetch,
      extra: Partial<ArthronClientOptions> = {},
    ) => arthron({ baseURL: "https://a/v1", fetchFn: fetch, ...extra });

    it("rejects the request with the caller's reason", async () => {
      const reason = new Error("navigated away");
      const ac = new AbortController();
      const pending = client(webkitFetch()).get("/u", { signal: ac.signal });
      ac.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
    it("rejects a timeout with its TimeoutError", async () => {
      const api = client(webkitFetch(), { plugins: [timeout(10)] });
      await expect(api.get("/u")).rejects.toMatchObject({
        name: "TimeoutError",
      });
    });
    it("rejects a body read with the caller's reason", async () => {
      const reason = new Error("navigated away");
      const ac = new AbortController();
      const pending = client(webkitFetch('{"a":'))
        .get("/u", { signal: ac.signal })
        .json();
      setTimeout(() => ac.abort(reason), 5);
      await expect(pending).rejects.toBe(reason);
    });
    it("ends an event stream with the caller's reason", async () => {
      const reason = new Error("navigated away");
      const ac = new AbortController();
      const events = client(webkitFetch("data: one\n\n"))
        .get("/u", { signal: ac.signal })
        .sse();
      const read = (async () => {
        for await (const _ of events) ac.abort(reason);
      })();
      await expect(read).rejects.toBe(reason);
    });
  });
  it("error interceptors see the ArthronError", async () => {
    const seen = vi.fn((e: ArthronError) => e);
    const { api } = make(fakeFetch(jsonResponse({}, { status: 500 })), {
      plugins: [{ transformError: seen }],
    });
    await expect(api.get("/u")).rejects.toBeInstanceOf(ArthronError);
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("arthron — immutability", () => {
  const tag = (v: string): Plugin => ({
    transformRequest: (c) => ({
      ...c,
      init: {
        ...c.init,
        headers: { ...(c.init.headers as object), "x-tag": v },
      },
    }),
  });

  it("use() returns a new client and leaves the parent untouched", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const parent = arthron({ baseURL: "https://a", fetchFn: fetch });
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
      fetchFn: fetch,
      headers: { "X-A": "p", "X-B": "p" },
      plugins: [tag("p")],
    });
    const child = parent.extend({
      headers: { "x-a": "c" },
      plugins: [tag("c")],
    });
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
    const parent = arthron({ baseURL: "https://a", fetchFn: fetch });
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
      fetchFn: fakeFetch(jsonResponse({})),
      plugins: [mark(log, "auth-v1", "auth"), mark(log, "other")],
    });
    await base.use(mark(log, "auth-v2", "auth")).get("/u");
    expect(log).toEqual(["auth-v2", "other"]);
  });
  it("unnamed plugins still append", async () => {
    const log: string[] = [];
    const base = arthron({
      baseURL: "https://a",
      fetchFn: fakeFetch(jsonResponse({})),
      plugins: [mark(log, "a")],
    });
    await base.use(mark(log, "b")).get("/u");
    expect(log).toEqual(["a", "b"]);
  });
  it("a second retry() replaces the inherited one instead of multiplying attempts", async () => {
    const fetch = fakeFetch(jsonResponse({}, { status: 503 }));
    const api = arthron({
      baseURL: "https://a",
      fetchFn: fetch,
      plugins: [retryWith({}, async () => {})],
    }).use(retry({ retries: 0 }));
    await expect(api.get("/u")).rejects.toMatchObject({ status: 503 });
    expect(fetch.calls).toHaveLength(1);
  });
  it("a replaced logging() keeps its outer position and logs once per call", async () => {
    const phases: string[] = [];
    const api = arthron({
      baseURL: "https://a",
      fetchFn: fakeFetch(jsonResponse({}, { status: 503 }), jsonResponse({})),
      plugins: [logging({ enabled: false }), retryWith({}, async () => {})],
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
      fetchFn: slow,
      plugins: [timeout(5)],
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
      fetchFn: fakeFetch(jsonResponse({})),
      plugins: [mark(log, "x1", "x"), mark(log, "y"), mark(log, "x2", "x")],
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
      fetchFn: fetch,
      plugins: [retryWith({}, async () => {})],
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

describe("arthron — 1.x option names", () => {
  it.each([
    ["use", [], "plugins"],
    ["errorDetail", () => undefined, "serverMessageFn"],
    ["allowAbsoluteUrls", true, "allowedOrigins"],
  ] as const)("refuses %s, naming its replacement", (old, value, now) => {
    const create = () =>
      arthron({ [old]: value } as unknown as ArthronClientOptions);
    expect(create).toThrow(TypeError);
    expect(create).toThrow(`arthron({ ${now} })`);
  });
  it.each([
    ["request", "transformRequest"],
    ["response", "transformResponse"],
    ["error", "transformError"],
  ])("refuses a plugin with a 1.x %s interceptor, naming %s", (old, now) => {
    const plugin = { name: "audit", [old]: (x: unknown) => x } as Plugin;
    const expected = `plugin "audit": the ${old} interceptor is called ${now} since 2.0`;
    expect(() => arthron({ plugins: [plugin] })).toThrow(expected);
    expect(() => arthron().use(plugin)).toThrow(expected);
  });
  it.each([
    ["path", "pathParams"],
    ["params", "queryParams"],
  ])("refuses the per-call %s option, naming %s", async (old, now) => {
    const { api } = make();
    const init = { [old]: { id: 1 } } as RequestOptions;
    await expect(api.get("/users/{id}", init)).rejects.toThrow(
      `{ ${now}: { … } }`,
    );
  });
});

describe("arthron — fetchFn", () => {
  it("refuses the 1.x fetch option, naming fetchFn", () => {
    // @ts-expect-error the option is fetchFn since 2.0
    const old = () => arthron({ fetch: fakeFetch(jsonResponse({})) });
    expect(old).toThrow(TypeError);
    expect(old).toThrow(/arthron\(\{ fetchFn \}\)/);
    // @ts-expect-error the option is fetchFn since 2.0
    expect(() => arthron().extend({ fetch: globalThis.fetch })).toThrow(
      /fetchFn/,
    );
  });
  it("fills ctx.fetchFn with the client's fetchFn", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const seen: unknown[] = [];
    const api = arthron({
      baseURL: "https://a",
      fetchFn: fetch,
      plugins: [
        {
          transformRequest: (ctx) => {
            seen.push(ctx.fetchFn);
            return ctx;
          },
        },
      ],
    });
    await api.get("/u");
    expect(seen).toEqual([fetch]);
  });
  it("sends with the fetchFn a plugin put in ctx.fetchFn, and still makes ArthronErrors", async () => {
    const client = fakeFetch(jsonResponse({}));
    const swapped = fakeFetch(jsonResponse({}, { status: 500 }));
    const api = arthron({
      baseURL: "https://a",
      fetchFn: client,
      plugins: [{ transformRequest: (ctx) => ({ ...ctx, fetchFn: swapped }) }],
    });
    const err = await api.get("/u").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArthronError);
    expect((err as ArthronError).status).toBe(500);
    expect(client.calls).toHaveLength(0);
    expect(swapped.calls).toHaveLength(1);
  });
});
