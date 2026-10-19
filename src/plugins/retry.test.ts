import { describe, expect, it, vi } from "vitest";
import { ferrule } from "../client";
import { fakeFetch, jsonResponse } from "../test-utils";
import { type RetryOptions, retry } from "./retry";

const sleepSpy = () => vi.fn(async (_ms: number) => {});
const noSleep = { sleep: sleepSpy() };
const err = (status: number, headers?: Record<string, string>) =>
  jsonResponse({}, { status, ...(headers ? { headers } : {}) });
const make = (fetch: ReturnType<typeof fakeFetch>, opts: RetryOptions = {}) =>
  ferrule({
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
    const api = ferrule({
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
  it("uses exponential backoff by default: 300, 600", async () => {
    const sleep = sleepSpy();
    await expect(
      make(fakeFetch(err(500)), { sleep }).get("/u"),
    ).rejects.toBeDefined();
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([300, 600]);
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
      { sleep },
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
    }).get("/u");
    expect(sleep.mock.calls[0]?.[0]).toBe(300);
  });
  it("stops immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetch = fakeFetch(err(500), jsonResponse({}));
    await expect(
      make(fetch).get("/u", { signal: ac.signal }),
    ).rejects.toMatchObject({
      status: 500,
    });
    expect(fetch.calls).toHaveLength(1);
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
});
