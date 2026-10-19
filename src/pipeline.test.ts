import { describe, expect, it, vi } from "vitest";
import { IeumError, isIeumError, networkError } from "./error";
import { runPipeline } from "./pipeline";
import { jsonResponse } from "./test-utils";
import type { Plugin, RequestContext } from "./types";

const ctx = (): RequestContext => ({
  url: "https://a/x",
  init: { method: "GET", headers: { a: "1" } },
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

  it("passes IeumError through error interceptors and always throws the result", async () => {
    const send = async (c: RequestContext) => {
      throw networkError(new Error("down"), c);
    };
    const tagged = vi.fn((e: IeumError) => Object.assign(e, { tagged: true }));
    await expect(
      runPipeline([{ error: tagged }], ctx(), send),
    ).rejects.toMatchObject({
      status: 0,
      tagged: true,
    });
    expect(tagged).toHaveBeenCalledTimes(1);
  });

  it("lets an error interceptor swap in a different IeumError", async () => {
    const send = async (c: RequestContext) => {
      throw networkError(new Error("down"), c);
    };
    const swapped = (e: IeumError) =>
      new IeumError({
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
    const error = vi.fn((e: IeumError) => e);
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
    const error = vi.fn((e: IeumError) => e);
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
    expect(isIeumError(bug)).toBe(false);
  });

  it("works with zero plugins", async () => {
    expect((await runPipeline([], ctx(), ok)).ok).toBe(true);
  });
});
