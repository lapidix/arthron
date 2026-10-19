import { describe, expect, it, vi } from "vitest";
import { arthron } from "../client";
import { isArthronError } from "../error";
import { fakeFetch, jsonResponse } from "../test-utils";
import { retry } from "./retry";
import { timeout } from "./timeout";

/** A fetch that never answers on its own but honours the signal. */
const hangingFetch = () => {
  const calls: AbortSignal[] = [];
  const impl = ((_url: string, init: RequestInit = {}) =>
    new Promise<Response>((_, reject) => {
      const signal = init.signal as AbortSignal;
      calls.push(signal);
      // Real fetch rejects at once for an already-aborted signal.
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    })) as unknown as typeof fetch;
  return Object.assign(impl, { calls });
};

describe("timeout", () => {
  it("rejects with a TimeoutError once the deadline passes", async () => {
    const fetch = hangingFetch();
    const api = arthron({ baseURL: "https://a", fetch, use: [timeout(10)] });
    const err = await api.get("/u").catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
    expect(isArthronError(err)).toBe(false);
    expect(fetch.calls[0]?.aborted).toBe(true);
  });
  it("lets a fast response through and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      const api = arthron({
        baseURL: "https://a",
        fetch: fakeFetch(jsonResponse({ ok: 1 })),
        use: [timeout(50)],
      });
      expect(await api.get("/u").json()).toEqual({ ok: 1 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("still honours the caller's own signal (AbortError, not TimeoutError)", async () => {
    const fetch = hangingFetch();
    const api = arthron({ baseURL: "https://a", fetch, use: [timeout(1000)] });
    const ac = new AbortController();
    const pending = api
      .get("/u", { signal: ac.signal })
      .catch((e: unknown) => e);
    ac.abort();
    expect(((await pending) as Error).name).toBe("AbortError");
  });
  it("rejects immediately when the caller's signal is already aborted", async () => {
    const fetch = hangingFetch();
    const api = arthron({ baseURL: "https://a", fetch, use: [timeout(1000)] });
    const ac = new AbortController();
    ac.abort();
    const err = await api
      .get("/u", { signal: ac.signal })
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
  });
  it("is not retried by retry()", async () => {
    const fetch = hangingFetch();
    const api = arthron({
      baseURL: "https://a",
      fetch,
      use: [retry({ sleep: async () => {} }), timeout(10)],
    });
    await expect(api.get("/u")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch.calls).toHaveLength(1);
  });
});
