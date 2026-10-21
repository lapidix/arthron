import { describe, expect, it, vi } from "vitest";
import { arthron } from "../../client/client";
import { isArthronError } from "../../error/arthron-error";
import { runPipeline } from "../../pipeline/pipeline";
import { fakeFetch, jsonResponse } from "../../testkit/fetch.testkit";
import type { RequestContext } from "../../types/request.types";
import { retryWithSleep } from "../retry/retry";
import { bearerAuth } from "./bearer-auth";

const API = "https://api.test";
const sentAuth = (fetch: { calls: { init: RequestInit }[] }) =>
  fetch.calls.map(
    (c) => (c.init.headers as Record<string, string>).authorization,
  );

/**
 * A session whose token starts as "old", and a server that answers 401 to
 * "Bearer old" and 200 to anything else.
 */
const setup = () => {
  const session = { current: "old" as string | null, refreshes: 0 };
  const refresh = async () => {
    session.refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    session.current = `new-${session.refreshes}`;
  };
  const calls: { url: string; authorization: string | undefined }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const authorization = (init.headers as Record<string, string>)
      .authorization;
    calls.push({ url, authorization });
    return authorization === "Bearer old"
      ? jsonResponse({}, { status: 401 })
      : jsonResponse({ ok: 1 });
  }) as unknown as typeof globalThis.fetch;
  return { session, refresh, fetch, calls };
};

describe("bearerAuth", () => {
  it("refuses the 1.x token and refresh options, naming their replacements", () => {
    const accessTokenFn = () => "t";
    expect(() =>
      // @ts-expect-error token is accessTokenFn since 2.0
      bearerAuth({ origin: API, token: accessTokenFn }),
    ).toThrow("bearerAuth({ accessTokenFn })");
    expect(() =>
      // @ts-expect-error refresh is refreshFn since 2.0
      bearerAuth({ origin: API, accessTokenFn, refresh: async () => {} }),
    ).toThrow("bearerAuth({ refreshFn })");
  });
  it("is named bearerAuth", () => {
    expect(
      bearerAuth({ origin: API, accessTokenFn: () => "t" }).pluginName,
    ).toBe("bearerAuth");
  });

  it("sends the token as a Bearer authorization header", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [bearerAuth({ origin: API, accessTokenFn: () => "abc" })],
    });
    await api.get("/me");
    expect(sentAuth(fetch)).toEqual(["Bearer abc"]);
  });

  it("reads the token on every attempt, sync or async", async () => {
    let n = 0;
    const fetch = fakeFetch(
      jsonResponse({}, { status: 503 }),
      jsonResponse({}),
    );
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        retryWithSleep({}, async () => {}),
        bearerAuth({ origin: API, accessTokenFn: async () => `t${++n}` }),
      ],
    });
    await api.get("/me");
    expect(sentAuth(fetch)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("sends no header without a token", async () => {
    for (const token of [null, undefined, ""]) {
      const fetch = fakeFetch(jsonResponse({}));
      const api = arthron({
        baseURL: API,
        fetchFn: fetch,
        plugins: [bearerAuth({ origin: API, accessTokenFn: () => token })],
      });
      await api.get("/me");
      expect(sentAuth(fetch)).toEqual([undefined]);
    }
  });

  it("sends the token to its origins only", async () => {
    const fetch = fakeFetch(jsonResponse({}));
    const api = arthron({
      baseURL: API,
      allowedOrigins: [
        "https://files.test",
        "https://cdn.test",
        "http://api.test",
      ],
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: [`${API}/v1/`, "https://files.test"],
          accessTokenFn: () => "abc",
        }),
      ],
    });
    await api.get("/me");
    await api.get("https://files.test/a");
    await api.get("https://cdn.test/asset");
    await api.get("http://api.test/me"); // another scheme is another origin
    expect(sentAuth(fetch)).toEqual([
      "Bearer abc",
      "Bearer abc",
      undefined,
      undefined,
    ]);
  });

  it("sends no token when the URL is not absolute", async () => {
    const seen: RequestContext[] = [];
    await runPipeline(
      [bearerAuth({ origin: API, accessTokenFn: () => "abc" })],
      { url: "/relative", init: { headers: {} }, meta: {} },
      async (ctx) => {
        seen.push(ctx);
        return jsonResponse({});
      },
    );
    expect(seen[0]?.init.headers.authorization).toBeUndefined();
  });

  it("refreshes once for concurrent 401s, and every call succeeds", async () => {
    const { session, refresh, fetch } = setup();
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    const out = await Promise.all(
      Array.from({ length: 5 }, () => api.get("/me").json()),
    );
    expect(out).toEqual(Array(5).fill({ ok: 1 }));
    expect(session.refreshes).toBe(1);
  });

  it("retries without refreshing when the token changed meanwhile", async () => {
    const { session, refresh, calls } = setup();
    // Another call refreshed while this one was in flight.
    const fetch = (async (_url: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>)
        .authorization;
      calls.push({ url: _url, authorization });
      if (authorization !== "Bearer old") return jsonResponse({ ok: 1 });
      session.current = "fresh";
      return jsonResponse({}, { status: 401 });
    }) as unknown as typeof globalThis.fetch;
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    expect(await api.get("/me").json()).toEqual({ ok: 1 });
    expect(session.refreshes).toBe(0);
    expect(calls.map((c) => c.authorization)).toEqual([
      "Bearer old",
      "Bearer fresh",
    ]);
  });

  it("refreshes after a 401 sent without a token", async () => {
    const { session, refresh } = setup();
    session.current = null;
    const fetch = fakeFetch(
      jsonResponse({}, { status: 401 }),
      jsonResponse({}),
    );
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    await api.get("/me");
    expect(session.refreshes).toBe(1);
    expect(sentAuth(fetch)).toEqual([undefined, "Bearer new-1"]);
  });

  it("redoes the call once: a second 401 is thrown", async () => {
    const { session, refresh } = setup();
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    const err = await api.get("/me").catch((e: unknown) => e);
    expect(isArthronError(err) && err.status).toBe(401);
    expect(session.refreshes).toBe(1);
    expect(fetch.calls).toHaveLength(2);
  });

  it("throws the 401 as is without refresh", async () => {
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [bearerAuth({ origin: API, accessTokenFn: () => "abc" })],
    });
    await expect(api.get("/me")).rejects.toMatchObject({ status: 401 });
    expect(fetch.calls).toHaveLength(1);
  });

  it("throws the 401 of a stream body, which cannot be sent again", async () => {
    const { session, refresh } = setup();
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    const body = new ReadableStream({
      start: (controller) => controller.close(),
    });
    await expect(api.post("/upload", body)).rejects.toMatchObject({
      status: 401,
    });
    expect(fetch.calls).toHaveLength(1);
    expect(session.refreshes).toBe(0);
  });

  it("leaves other failures alone", async () => {
    const { session, refresh } = setup();
    const fetch = fakeFetch(jsonResponse({}, { status: 403 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    await expect(api.get("/me")).rejects.toMatchObject({ status: 403 });
    expect(session.refreshes).toBe(0);
    expect(fetch.calls).toHaveLength(1);
  });

  it("does not refresh for a 401 from another origin", async () => {
    const { session, refresh } = setup();
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      allowedOrigins: ["https://other.test"],
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    await expect(api.get("https://other.test/x")).rejects.toMatchObject({
      status: 401,
    });
    expect(session.refreshes).toBe(0);
  });

  it("hands a failed refresh to every waiting call", async () => {
    let refreshes = 0;
    const failure = new Error("session expired");
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => "old",
          refreshFn: async () => {
            refreshes += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw failure;
          },
        }),
      ],
    });
    const out = await Promise.allSettled([api.get("/a"), api.get("/b")]);
    expect(out).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(refreshes).toBe(1);
  });

  it("refreshes again after a failed refresh", async () => {
    let refreshes = 0;
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => "old",
          refreshFn: async () => {
            refreshes += 1;
            throw new Error("offline");
          },
        }),
      ],
    });
    await expect(api.get("/a")).rejects.toThrow("offline");
    await expect(api.get("/a")).rejects.toThrow("offline");
    expect(refreshes).toBe(2);
  });

  it("skips a call with meta.bearerAuth: false — no token, no refresh", async () => {
    const { session, refresh } = setup();
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => session.current,
          refreshFn: refresh,
        }),
      ],
    });
    await expect(
      api.post("/login", {}, { meta: { bearerAuth: false } }),
    ).rejects.toMatchObject({ status: 401 });
    expect(sentAuth(fetch)).toEqual([undefined]);
    expect(session.refreshes).toBe(0);
  });

  it("can refresh through the client it is on, with meta.bearerAuth: false", async () => {
    let current = "old";
    const fetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/token")) return jsonResponse({ token: "new" });
      return (init.headers as Record<string, string>).authorization ===
        "Bearer new"
        ? jsonResponse({ ok: 1 })
        : jsonResponse({}, { status: 401 });
    }) as unknown as typeof globalThis.fetch;
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => current,
          refreshFn: async () => {
            const res = await api
              .post("/token", {}, { meta: { bearerAuth: false } })
              .json<{ token: string }>();
            current = res.token;
          },
        }),
      ],
    });
    expect(await api.get("/me").json()).toEqual({ ok: 1 });
  });
  it("sends what refreshFn starts before its first await without the token or a refresh", async () => {
    let current = "old";
    const fetch = fakeFetch(
      () => jsonResponse({}, { status: 401 }),
      () => jsonResponse({ token: "new" }),
      () => jsonResponse({ ok: 1 }),
    );
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => current,
          // No meta: { bearerAuth: false } on the refresh call.
          refreshFn: async () => {
            const res = await api.post("/token", {}).json<{ token: string }>();
            current = res.token;
          },
        }),
      ],
    });
    expect(await api.get("/me").json()).toEqual({ ok: 1 });
    expect(sentAuth(fetch)).toEqual(["Bearer old", undefined, "Bearer new"]);
  });
  it("rejects, instead of waiting on itself, when that refresh call gets a 401", async () => {
    const fetch = fakeFetch(jsonResponse({}, { status: 401 }));
    const api = arthron({
      baseURL: API,
      fetchFn: fetch,
      plugins: [
        bearerAuth({
          origin: API,
          accessTokenFn: () => "expired",
          refreshFn: async () => {
            await api.post("/token", {});
          },
        }),
      ],
    });
    const err = await api.get("/me").catch((e: unknown) => e);
    expect(isArthronError(err) && err.status).toBe(401);
    expect(fetch.calls.map((c) => c.url)).toEqual([
      `${API}/me`,
      `${API}/token`,
    ]);
  }, 1000);
  it("sends the token to a relative baseURL on its origin's page", async () => {
    vi.stubGlobal("location", { href: "https://app.test/dashboard" });
    try {
      const fetch = fakeFetch(jsonResponse({}));
      const client = (origin: string) =>
        arthron({
          baseURL: "/api",
          fetchFn: fetch,
          plugins: [bearerAuth({ origin, accessTokenFn: () => "abc" })],
        });
      await client("https://app.test").get("/me");
      await client(API).get("/me");
      expect(sentAuth(fetch)).toEqual(["Bearer abc", undefined]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an origin that is not an http(s) URL", () => {
    for (const origin of ["api.test", "", "mailto:a@b.test"]) {
      expect(() => bearerAuth({ origin, accessTokenFn: () => "t" })).toThrow(
        /bearerAuth\(\{ origin \}\) needs an http\(s\) URL/,
      );
    }
    expect(() => bearerAuth({ origin: [], accessTokenFn: () => "t" })).toThrow(
      TypeError,
    );
  });
});
