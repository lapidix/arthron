import { describe, expect, it, vi } from "vitest";
import { ArthronError, isArthronError } from "../error/arthron-error";
import { networkError } from "../error/error";
import { jsonResponse } from "../testkit/fetch.testkit";
import type { RequestContext } from "../types/context.types";
import type { Plugin } from "../types/plugin.types";
import { runPipeline } from "./pipeline";

declare module "../types/context.types" {
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
        middleware: async (c, next) => {
          log.push("m1>");
          const r = await next(c);
          log.push("<m1");
          return r;
        },
      },
      {
        middleware: async (c, next) => {
          log.push("m2>");
          const r = await next(c);
          log.push("<m2");
          return r;
        },
      },
      {
        request: (c) => {
          log.push("req1");
          return c;
        },
        response: (r) => {
          log.push("res1");
          return r;
        },
      },
      {
        request: (c) => {
          log.push("req2");
          return c;
        },
        response: (r) => {
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
      middleware: async (c, next) => {
        await next(c);
        return next(c);
      },
    };
    await runPipeline([twice, { request }], ctx(), send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("clones context per attempt so header mutations do not leak into the next attempt", async () => {
    const seen: string[] = [];
    const mutate: Plugin = {
      request: (c) => {
        const h = c.init.headers as Record<string, string>;
        seen.push(h["x-try"] ?? "none");
        h["x-try"] = "set";
        return c;
      },
    };
    const twice: Plugin = {
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
        request: (c) => {
          (c.init.body as unknown as Appendable).append("csrf", "t");
          return c;
        },
      };
      const twice: Plugin = {
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
      request: (c) => {
        const h = new Headers(c.init.headers);
        h.set("X-Trace", "t1");
        // A plugin written in JS (or with a cast) may hand back a Headers object.
        return { ...c, init: { ...c.init, headers: h as never } };
      },
    };
    const spreads: Plugin = {
      request: (c) => ({
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
          request: (c) => {
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
      [{ request: (c) => ({ url: c.url, init: c.init }) as RequestContext }],
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
          request: (c) => {
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
      [{ request: (c) => ({ ...c, url: "https://b/y" }) }],
      ctx(),
      send,
    );
    expect(send.mock.calls[0]?.[0].url).toBe("https://b/y");
  });

  it("lets response interceptors replace the response", async () => {
    const res = await runPipeline(
      [{ response: () => new Response("swapped") }],
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
      runPipeline([{ error: tagged }], ctx(), send),
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
        data: e.data,
        request: e.request,
      });
    await expect(
      runPipeline([{ error: swapped }], ctx(), send),
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
        runPipeline([{ error }], ctx(), async () => {
          throw ex;
        }),
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
            request: () => {
              throw bug;
            },
          },
          { error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(bug);
    await expect(
      runPipeline(
        [
          {
            response: () => {
              throw bug;
            },
          },
          { error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(bug);
    await expect(
      runPipeline(
        [
          {
            middleware: () => {
              throw bug;
            },
          },
          { error },
        ],
        ctx(),
        ok,
      ),
    ).rejects.toBe(bug);
    expect(error).not.toHaveBeenCalled();
    expect(isArthronError(bug)).toBe(false);
  });

  it("works with zero plugins", async () => {
    expect((await runPipeline([], ctx(), ok)).ok).toBe(true);
  });
});
