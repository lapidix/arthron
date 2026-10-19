import { describe, expect, it, vi } from "vitest";
import { arthron } from "../../client/client";
import { fakeFetch, jsonResponse } from "../../testkit/fetch.testkit";
import type { RetryOptions } from "../../types/request.types";
import { timeout } from "../timeout/timeout";
import { retry } from "./retry";

const sleepSpy = () => vi.fn(async (_ms: number) => {});
const noSleep = { sleep: sleepSpy() };
const err = (status: number, headers?: Record<string, string>) =>
  jsonResponse({}, { status, ...(headers ? { headers } : {}) });
const make = (fetch: ReturnType<typeof fakeFetch>, opts: RetryOptions = {}) =>
  arthron({
    baseURL: "https://a",
    fetch,
    use: [retry({ ...noSleep, ...opts })],
  });

describe("retry", () => {
  it("retries up to `retries` times on retryable status, then throws the last error", async () => {
    const fetch = fakeFetch(err(503), err(503), err(503), err(503));
    await expect(make(fetch).get("/u")).rejects.toMatchObject({ status: 503 });
    expect(fetch.calls).toHaveLength(3);
  });
  it("returns the first successful response", async () => {
    const fetch = fakeFetch(err(500), jsonResponse({ ok: 1 }));
    expect(await make(fetch).get("/u").json()).toEqual({ ok: 1 });
    expect(fetch.calls).toHaveLength(2);
  });
  it("retries network errors (status 0)", async () => {
    const fetch = fakeFetch(new TypeError("down"), jsonResponse({}));
    await make(fetch).get("/u");
    expect(fetch.calls).toHaveLength(2);
  });
  it("does not retry non-retryable statuses", async () => {
    const fetch = fakeFetch(err(404));
    await expect(make(fetch).get("/u")).rejects.toMatchObject({ status: 404 });
    expect(fetch.calls).toHaveLength(1);
  });
  it("does not retry non-idempotent methods by default, but does when configured", async () => {
    const f1 = fakeFetch(err(500), jsonResponse({}));
    await expect(make(f1).post("/u", {})).rejects.toMatchObject({
      status: 500,
    });
    expect(f1.calls).toHaveLength(1);
    const f2 = fakeFetch(err(500), jsonResponse({}));
    await make(f2, { methods: ["POST"] }).post("/u", {});
    expect(f2.calls).toHaveLength(2);
  });
  it("retries QUERY by default — RFC 10008 defines it as safe and idempotent", async () => {
    const fetch = fakeFetch(err(500), jsonResponse({}));
    await make(fetch).query("/u", { q: "x" });
    expect(fetch.calls).toHaveLength(2);
  });
  it("does not retry a ReadableStream body", async () => {
    const fetch = fakeFetch(err(500), jsonResponse({}));
    await expect(
      make(fetch, { methods: ["POST"] }).post("/u", new ReadableStream()),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetch.calls).toHaveLength(1);
  });
  it("does not retry interceptor bugs or cancellations", async () => {
    const bug = new RangeError("bug");
    const fetch = fakeFetch(jsonResponse({}));
    const api = arthron({
      baseURL: "https://a",
      fetch,
      use: [
        retry(noSleep),
        {
          request: () => {
            throw bug;
          },
        },
      ],
    });
    await expect(api.get("/u")).rejects.toBe(bug);
    expect(fetch.calls).toHaveLength(0);
  });
  it("uses full-jitter exponential backoff by default: random share of 300, 600", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const sleep = sleepSpy();
      await expect(
        make(fakeFetch(err(500)), { sleep }).get("/u"),
      ).rejects.toBeDefined();
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([150, 300]);
    } finally {
      random.mockRestore();
    }
  });
  it("honours Retry-After in seconds", async () => {
    const sleep = sleepSpy();
    await make(fakeFetch(err(429, { "retry-after": "2" }), jsonResponse({})), {
      sleep,
    }).get("/u");
    expect(sleep.mock.calls[0]?.[0]).toBe(2000);
  });
  it("honours Retry-After as an HTTP-date (never NaN)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T00:00:00Z") });
    try {
      const sleep = sleepSpy();
      await make(
        fakeFetch(
          err(503, { "retry-after": "Mon, 19 Oct 2026 00:00:05 GMT" }),
          jsonResponse({}),
        ),
        { sleep },
      ).get("/u");
      expect(sleep.mock.calls[0]?.[0]).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });
  it("falls back to delay() when Retry-After is garbage", async () => {
    const sleep = sleepSpy();
    await make(
      fakeFetch(err(503, { "retry-after": "soon" }), jsonResponse({})),
      { sleep, delay: () => 300 },
    ).get("/u");
    expect(sleep.mock.calls[0]?.[0]).toBe(300);
  });
  it("gives up (no retry) when Retry-After exceeds maxRetryAfter", async () => {
    const sleep = sleepSpy();
    const fetch = fakeFetch(
      err(503, { "retry-after": "2592000" }),
      jsonResponse({}),
    );
    await expect(make(fetch, { sleep }).get("/u")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetch.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("honours a custom maxRetryAfter", async () => {
    const sleep = sleepSpy();
    const fetch = fakeFetch(
      err(503, { "retry-after": "120" }),
      jsonResponse({}),
    );
    await make(fetch, { sleep, maxRetryAfter: 200_000 }).get("/u");
    expect(sleep.mock.calls[0]?.[0]).toBe(120_000);
  });
  it("treats an empty Retry-After as absent", async () => {
    const sleep = sleepSpy();
    await make(fakeFetch(err(503, { "retry-after": "" }), jsonResponse({})), {
      sleep,
      delay: () => 300,
    }).get("/u");
    expect(sleep.mock.calls[0]?.[0]).toBe(300);
  });
  it("stops immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    // This fake answers despite the abort; arthron still surfaces the abort.
    const fetch = fakeFetch(err(500), jsonResponse({}));
    await expect(
      make(fetch).get("/u", { signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch.calls).toHaveLength(1);
  });
  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects retries: %s with a TypeError when the plugin is created",
    (retries) => {
      expect(() => retry({ retries })).toThrow(TypeError);
    },
  );
  it("caps a backoff longer than setTimeout can hold instead of firing at once", async () => {
    const sleep = sleepSpy();
    await make(fakeFetch(err(503), jsonResponse({})), {
      sleep,
      delay: () => 2 ** 32,
    }).get("/u");
    expect(sleep.mock.calls[0]?.[0]).toBe(2 ** 31 - 1);
  });
  it("meta.retry: false turns retry off for one call", async () => {
    const fetch = fakeFetch(err(503), jsonResponse({}));
    await expect(
      make(fetch).get("/u", { meta: { retry: false } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch.calls).toHaveLength(1);
  });
  it("meta.retry overrides options for one call", async () => {
    const f1 = fakeFetch(err(503), err(503), err(503), err(503), err(503));
    await expect(
      make(f1).get("/u", { meta: { retry: { retries: 4 } } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(f1.calls).toHaveLength(5);
    const f2 = fakeFetch(err(500), jsonResponse({}));
    await make(f2).post("/u", {}, { meta: { retry: { methods: ["POST"] } } });
    expect(f2.calls).toHaveLength(2);
  });
  it("rejects an invalid meta.retry.retries with a TypeError", async () => {
    await expect(
      make(fakeFetch(jsonResponse({}))).get("/u", {
        meta: { retry: { retries: -1 } },
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
  it("propagates the abort reason when aborted while sleeping", async () => {
    const reason = new DOMException("a", "AbortError");
    const sleep = vi.fn(async () => {
      throw reason;
    });
    const fetch = fakeFetch(err(500), jsonResponse({}));
    await expect(make(fetch, { sleep }).get("/u")).rejects.toBe(reason);
    expect(fetch.calls).toHaveLength(1);
  });

  describe("shouldRetry / onRetry", () => {
    it("false stops a retry the defaults would make", async () => {
      const fetch = fakeFetch(err(503), jsonResponse({}));
      await expect(
        make(fetch, { shouldRetry: () => false }).get("/u"),
      ).rejects.toMatchObject({ status: 503 });
      expect(fetch.calls).toHaveLength(1);
    });
    it("true retries what the defaults would not — a 404, a POST", async () => {
      const f1 = fakeFetch(err(404), jsonResponse({}));
      await make(f1, { shouldRetry: () => true }).get("/u");
      expect(f1.calls).toHaveLength(2);
      const f2 = fakeFetch(err(500), jsonResponse({}));
      await make(f2, { shouldRetry: () => true }).post("/u", {});
      expect(f2.calls).toHaveLength(2);
    });
    it("undefined falls back to the defaults", async () => {
      const fetch = fakeFetch(err(503), jsonResponse({}));
      await make(fetch, { shouldRetry: () => undefined }).get("/u");
      expect(fetch.calls).toHaveLength(2);
    });
    it("can opt in to retrying an inner timeout", async () => {
      let calls = 0;
      const hangsOnce = ((_url: string, init: RequestInit) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(jsonResponse({ ok: 1 }));
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        });
      }) as unknown as typeof fetch;
      const api = arthron({
        baseURL: "https://a",
        fetch: hangsOnce,
        use: [
          retry({
            ...noSleep,
            shouldRetry: (e) =>
              (e as Error).name === "TimeoutError" ? true : undefined,
          }),
          timeout(10),
        ],
      });
      expect(await api.get("/u").json()).toEqual({ ok: 1 });
      expect(calls).toBe(2);
    });
    it("cannot override the budget, a stream body or an abort", async () => {
      const f1 = fakeFetch(err(503));
      await expect(
        make(f1, { retries: 1, shouldRetry: () => true }).get("/u"),
      ).rejects.toBeDefined();
      expect(f1.calls).toHaveLength(2);
      const f2 = fakeFetch(err(500), jsonResponse({}));
      await expect(
        make(f2, { shouldRetry: () => true }).post("/u", new ReadableStream()),
      ).rejects.toBeDefined();
      expect(f2.calls).toHaveLength(1);
    });
    it("onRetry hears each retry with the wait it is about to take", async () => {
      const heard: [number, number][] = [];
      await make(fakeFetch(err(503), err(503), jsonResponse({})), {
        delay: (n) => (n + 1) * 10,
        onRetry: (_e, attempt, wait) => heard.push([attempt, wait]),
      }).get("/u");
      expect(heard).toEqual([
        [0, 10],
        [1, 20],
      ]);
    });
  });
});
