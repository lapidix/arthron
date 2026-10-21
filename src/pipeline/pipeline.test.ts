import { describe, expect, it, vi } from "vitest";
import { ArthronError, isArthronError } from "../error/arthron-error";
import { networkError } from "../error/create-error";
import { jsonResponse } from "../testkit/fetch.testkit";
import type { Plugin } from "../types/plugin.types";
import type { RequestContext } from "../types/request.types";
import { runPipeline } from "./pipeline";

declare module "../types/request.types" {
  interface ArthronMeta {
    skipAuth?: boolean;
  }
}

const ctx = (): RequestContext => ({
  url: "https://a/x",
  init: { method: "GET", headers: { a: "1" } },
  meta: {},
});
const ok = async () => jsonResponse({});

describe("runPipeline", () => {
  it("runs middleware outside-in in registration order and interceptors in order", async () => {
    const log: string[] = [];
    const plugins: Plugin[] = [
      {
        pluginName: "p26",
        middleware: async (c, next) => {
          log.push("m1>");
          const r = await next(c);
          log.push("<m1");
          return r;
        },
      },
      {
        pluginName: "p34",
        middleware: async (c, next) => {
          log.push("m2>");
          const r = await next(c);
          log.push("<m2");
          return r;
        },
      },
      {
        pluginName: "p42",
        requestInterceptor: (c) => {
          log.push("req1");
          return c;
        },
        responseInterceptor: (r) => {
          log.push("res1");
          return r;
        },
      },
      {
        pluginName: "p52",
        requestInterceptor: (c) => {
          log.push("req2");
          return c;
        },
        responseInterceptor: (r) => {
          log.push("res2");
          return r;
        },
      },
    ];
    await runPipeline(plugins, ctx(), async () => {
      log.push("send");
      return jsonResponse({});
    });
    expect(log).toEqual([
      "m1>",
      "m2>",
      "req1",
      "req2",
      "send",
      "res1",
      "res2",
      "<m2",
      "<m1",
    ]);
  });

  it("re-running next re-runs request interceptors and send", async () => {
    const send = vi.fn(ok);
    const request = vi.fn((c: RequestContext) => c);
    const twice: Plugin = {
      pluginName: "p83",
      middleware: async (c, next) => {
        await next(c);
        return next(c);
      },
    };
    await runPipeline(
      [twice, { pluginName: "p89", requestInterceptor: request }],
      ctx(),
      send,
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("clones context per attempt so header mutations do not leak into the next attempt", async () => {
    const seen: string[] = [];
    const mutate: Plugin = {
      pluginName: "p96",
      requestInterceptor: (c) => {
        const h = c.init.headers as Record<string, string>;
        seen.push(h["x-try"] ?? "none");
        h["x-try"] = "set";
        return c;
      },
    };
    const twice: Plugin = {
      pluginName: "p104",
      middleware: async (c, next) => {
        await next(c);
        return next(c);
      },
    };
    await runPipeline([twice, mutate], ctx(), ok);
    expect(seen).toEqual(["none", "none"]);
  });

  it.each([
    ["FormData", () => new FormData()],
    ["URLSearchParams", () => new URLSearchParams()],
  ] as const)(
    "clones a %s body per attempt so in-place appends do not pile up",
    async (_, make) => {
      type Appendable = {
        append(k: string, v: string): void;
        getAll(k: string): unknown[];
      };
      const seen: number[] = [];
      const addToken: Plugin = {
        pluginName: "p125",
        requestInterceptor: (c) => {
          (c.init.body as unknown as Appendable).append("csrf", "t");
          return c;
        },
      };
      const twice: Plugin = {
        pluginName: "p131",
        middleware: async (c, next) => {
          await next(c);
          return next(c);
        },
      };
      await runPipeline(
        [twice, addToken],
        {
          url: "https://a/x",
          init: { method: "POST", body: make(), headers: {} },
          meta: {},
        },
        async (c) => {
          seen.push(
            (c.init.body as unknown as Appendable).getAll("csrf").length,
          );
          return jsonResponse({});
        },
      );
      expect(seen).toEqual([1, 1]);
    },
  );

  it("normalizes headers after every request interceptor, so the next one can spread them", async () => {
    const send = vi.fn(async (_c: RequestContext) => jsonResponse({}));
    const asHeaders: Plugin = {
      pluginName: "p157",
      requestInterceptor: (c) => {
        const h = new Headers(c.init.headers);
        h.set("X-Trace", "t1");
        // A plugin written in JS (or with a cast) may hand back a Headers object.
        return { ...c, init: { ...c.init, headers: h as never } };
      },
    };
    const spreads: Plugin = {
      pluginName: "p165",
      requestInterceptor: (c) => ({
        ...c,
        init: { ...c.init, headers: { ...c.init.headers, authorization: "x" } },
      }),
    };
    await runPipeline([asHeaders, spreads], ctx(), send);
    expect(send.mock.calls[0]?.[0].init.headers).toEqual({
      a: "1",
      "x-trace": "t1",
      authorization: "x",
    });
  });
  it("types ctx.init.headers as a lowercase record plugins can read", async () => {
    const seen: (string | undefined)[] = [];
    await runPipeline(
      [
        {
          pluginName: "p182",
          requestInterceptor: (c) => {
            seen.push(c.init.headers.a);
            return c;
          },
        },
      ],
      ctx(),
      ok,
    );
    expect(seen).toEqual(["1"]);
  });

  it("keeps meta when an interceptor returns a context without it", async () => {
    const send = vi.fn(async (_c: RequestContext) => jsonResponse({}));
    await runPipeline(
      [
        {
          pluginName: "p199",
          requestInterceptor: (c) =>
            ({ url: c.url, init: c.init }) as RequestContext,
        },
      ],
      { ...ctx(), meta: { timeout: 7 } },
      send,
    );
    expect(send.mock.calls[0]?.[0].meta).toEqual({ timeout: 7 });
  });
  it("lets plugins declare their own meta keys by augmentation", async () => {
    const seen: (boolean | undefined)[] = [];
    await runPipeline(
      [
        {
          pluginName: "p213",
          requestInterceptor: (c) => {
            seen.push(c.meta.skipAuth);
            return c;
          },
        },
      ],
      { ...ctx(), meta: { skipAuth: true } },
      ok,
    );
    expect(seen).toEqual([true]);
  });

  it("lets request interceptors replace the context", async () => {
    const send = vi.fn(async (_c: RequestContext) => jsonResponse({}));
    await runPipeline(
      [
        {
          pluginName: "p229",
          requestInterceptor: (c) => ({ ...c, url: "https://b/y" }),
        },
      ],
      ctx(),
      send,
    );
    expect(send.mock.calls[0]?.[0].url).toBe("https://b/y");
  });

  it("lets response interceptors replace the response", async () => {
    const res = await runPipeline(
      [
        {
          pluginName: "p238",
          responseInterceptor: () => new Response("swapped"),
        },
      ],
      ctx(),
      ok,
    );
    expect(await res.text()).toBe("swapped");
  });

  it("passes ArthronError through error interceptors and always throws the result", async () => {
    const send = async (c: RequestContext) => {
      throw networkError(new Error("down"), c);
    };
    const tagged = vi.fn((e: ArthronError) =>
      Object.assign(e, { tagged: true }),
    );
    await expect(
      runPipeline(
        [{ pluginName: "p253", errorInterceptor: tagged }],
        ctx(),
        send,
      ),
    ).rejects.toMatchObject({
      status: 0,
      tagged: true,
    });
    expect(tagged).toHaveBeenCalledTimes(1);
  });

  it("lets an error interceptor swap in a different ArthronError", async () => {
    const send = async (c: RequestContext) => {
      throw networkError(new Error("down"), c);
    };
    const swapped = (e: ArthronError) =>
      new ArthronError({
        message: "swapped",
        status: 599,
        statusText: "",
        headers: e.headers,
        payload: e.payload,
        request: e.request,
      });
    await expect(
      runPipeline(
        [{ pluginName: "p275", errorInterceptor: swapped }],
        ctx(),
        send,
      ),
    ).rejects.toMatchObject({
      message: "swapped",
      status: 599,
    });
  });

  it("rethrows AbortError/TimeoutError untouched without running error interceptors", async () => {
    const error = vi.fn((e: ArthronError) => e);
    for (const name of ["AbortError", "TimeoutError"]) {
      const ex = new DOMException("x", name);
      await expect(
        runPipeline(
          [{ pluginName: "p287", errorInterceptor: error }],
          ctx(),
          async () => {
            throw ex;
          },
        ),
      ).rejects.toBe(ex);
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("rethrows interceptor/middleware exceptions untouched (not wrapped, no error interceptors)", async () => {
    const error = vi.fn((e: ArthronError) => e);
    const bug = new RangeError("bug");
    await expect(
      runPipeline(
        [
          {
            pluginName: "p301",
            requestInterceptor: () => {
              throw bug;
            },
          },
          { pluginName: "p306", errorInterceptor: error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(bug);
    await expect(
      runPipeline(
        [
          {
            pluginName: "p315",
            responseInterceptor: () => {
              throw bug;
            },
          },
          { pluginName: "p320", errorInterceptor: error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(bug);
    await expect(
      runPipeline(
        [
          {
            pluginName: "p329",
            middleware: () => {
              throw bug;
            },
          },
          { pluginName: "p334", errorInterceptor: error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(bug);
    expect(error).not.toHaveBeenCalled();
    expect(isArthronError(bug)).toBe(false);
  });

  it("treats an ArthronError a plugin throws as a plugin exception", async () => {
    // e.g. a request interceptor whose own call (a token endpoint) failed
    const error = vi.fn((e: ArthronError) => e);
    const inner = networkError(new Error("down"), {
      url: "https://auth.test/token",
      init: { headers: {} },
      meta: {},
    });
    const thrower = () => {
      throw inner;
    };
    await expect(
      runPipeline(
        [
          { pluginName: "p357", requestInterceptor: thrower },
          { pluginName: "p357", errorInterceptor: error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(inner);
    await expect(
      runPipeline(
        [
          { pluginName: "p364", responseInterceptor: thrower },
          { pluginName: "p364", errorInterceptor: error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(inner);
    expect(error).not.toHaveBeenCalled();
  });

  it("names an interceptor or middleware that returns nothing", async () => {
    const nothing = (() => undefined) as never;
    await expect(
      runPipeline(
        [{ pluginName: "p375", requestInterceptor: nothing }],
        ctx(),
        ok,
      ),
    ).rejects.toThrow(/a request interceptor returned undefined — return/);
    await expect(
      runPipeline(
        [{ pluginName: "p378", responseInterceptor: nothing }],
        ctx(),
        ok,
      ),
    ).rejects.toThrow(/a response interceptor returned undefined — return/);
    const failed = networkError(new Error("down"), ctx());
    const err = await runPipeline(
      [{ pluginName: "p382", errorInterceptor: nothing }],
      ctx(),
      async () => {
        throw failed;
      },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(
      /an error interceptor returned undefined — return/,
    );
    expect((err as Error).cause).toBe(failed);
    await expect(
      runPipeline(
        [{ pluginName: "p394", middleware: async () => undefined as never }],
        ctx(),
        ok,
      ),
    ).rejects.toThrow(/a middleware resolved with undefined — return/);
  });

  it("keeps ctx.fetchFn across interceptors and middleware that build a fresh context", async () => {
    const f = (async () => jsonResponse({})) as unknown as typeof fetch;
    const seen: unknown[] = [];
    await runPipeline(
      [
        {
          pluginName: "p403",
          requestInterceptor: (c) => ({
            url: c.url,
            init: c.init,
            meta: c.meta,
          }),
        },
        {
          pluginName: "p410",
          middleware: (c, next) =>
            next({ url: c.url, init: c.init, meta: c.meta }),
        },
      ],
      { ...ctx(), fetchFn: f },
      async (c) => {
        seen.push(c.fetchFn);
        return jsonResponse({});
      },
    );
    expect(seen).toEqual([f]);
  });

  it("lets a request interceptor replace ctx.fetchFn for one attempt", async () => {
    const f = (async () => jsonResponse({})) as unknown as typeof fetch;
    const g = (async () => jsonResponse({})) as unknown as typeof fetch;
    const seen: unknown[] = [];
    let attempt = 0;
    await runPipeline(
      [
        {
          pluginName: "p431",
          middleware: async (c, next) => {
            await next(c);
            return next(c);
          },
          requestInterceptor: (c) =>
            ++attempt === 1 ? { ...c, fetchFn: g } : c,
        },
      ],
      { ...ctx(), fetchFn: f },
      async (c) => {
        seen.push(c.fetchFn);
        return jsonResponse({});
      },
    );
    expect(seen).toEqual([g, f]);
  });

  it("works with zero plugins", async () => {
    expect((await runPipeline([], ctx(), ok)).ok).toBe(true);
  });
});
