import { describe, expect, it, vi } from "vitest";
import { arthron } from "../client/client";
import { isArthronError } from "../error/arthron-error";
import { fakeFetch, jsonResponse } from "../testkit/fetch.testkit";
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

describe("timeout — the response it hands back", () => {
  it("keeps url, redirected and type from the fetched response", async () => {
    const fetched = Object.defineProperties(jsonResponse({}), {
      url: { value: "https://a/final" },
      redirected: { value: true },
      type: { value: "basic" },
    });
    const api = arthron({
      baseURL: "https://a",
      fetch: fakeFetch(fetched),
      use: [timeout(1000)],
    });
    const res = await api.get("/start");
    expect([res.url, res.redirected, res.type]).toEqual([
      "https://a/final",
      true,
      "basic",
    ]);
    await res.text();
  });
  it("does not keep the Node process alive while a body sits unread", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    try {
      const api = arthron({
        baseURL: "https://a",
        fetch: fakeFetch(jsonResponse({})),
        use: [timeout(30_000)],
      });
      const res = await api.get("/u");
      const timer = spy.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
      await res.text();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("timeout — meta.timeout per call", () => {
  /** Answers after `ms` unless its signal aborts first, as fetch would. */
  const answersAfter = (ms: number) =>
    ((_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        const t = setTimeout(() => resolve(jsonResponse({ ok: 1 })), ms);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(signal?.reason);
          },
          { once: true },
        );
      })) as unknown as typeof fetch;
  it("lengthens the deadline for one call", async () => {
    const api = arthron({
      baseURL: "https://a",
      fetch: answersAfter(40),
      use: [timeout(10)],
    });
    expect(await api.get("/u", { meta: { timeout: 1000 } }).json()).toEqual({
      ok: 1,
    });
  });
  it("shortens the deadline for one call", async () => {
    const api = arthron({
      baseURL: "https://a",
      fetch: answersAfter(200),
      use: [timeout(5000)],
    });
    await expect(
      api.get("/u", { meta: { timeout: 10 } }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
  it("Infinity lifts the deadline for one call", async () => {
    const api = arthron({
      baseURL: "https://a",
      fetch: answersAfter(40),
      use: [timeout(10)],
    });
    expect(
      await api
        .get("/u", { meta: { timeout: Number.POSITIVE_INFINITY } })
        .json(),
    ).toEqual({ ok: 1 });
  });
});

describe("timeout(ms) bounds", () => {
  it("Infinity means no deadline", async () => {
    // Answers after 20 ms unless its signal aborts first, as fetch would.
    const slow = ((_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        const t = setTimeout(() => resolve(jsonResponse({ ok: 1 })), 20);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(signal?.reason);
          },
          { once: true },
        );
      })) as unknown as typeof fetch;
    const api = arthron({
      baseURL: "https://a",
      fetch: slow,
      use: [timeout(Number.POSITIVE_INFINITY)],
    });
    expect(await api.get("/u").json()).toEqual({ ok: 1 });
  });
  it.each([Number.NaN, -1, 2 ** 31])(
    "rejects %s with a TypeError when the plugin is created",
    (ms) => {
      expect(() => timeout(ms)).toThrow(TypeError);
    },
  );
});

describe("timeout while reading an error body", () => {
  it("rejects with TimeoutError, not the status, and is not retried", async () => {
    let calls = 0;
    // A 503 whose body never finishes but errors once the signal aborts, as fetch's does.
    const stalled = ((_url: string, init: RequestInit) => {
      calls += 1;
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener(
            "abort",
            () => controller.error(signal.reason),
            { once: true },
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 503 }));
    }) as unknown as typeof fetch;
    const api = arthron({
      baseURL: "https://a",
      fetch: stalled,
      use: [retry({ sleep: async () => {} }), timeout(20)],
    });
    const err = await api.get("/u").catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
    expect(calls).toBe(1);
  });
});

describe("timeout while streaming", () => {
  it("aborts an SSE body that stalls past the deadline", async () => {
    // Headers arrive at once, the body never finishes.
    const stalled = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: first\n\n"));
              // never close
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      )) as unknown as typeof fetch;
    const api = arthron({
      baseURL: "https://a",
      fetch: stalled,
      use: [timeout(30)],
    });
    const seen: string[] = [];
    const run = async () => {
      for await (const e of api.get("/stream").sse()) seen.push(e.data);
    };
    const err = await run().catch((e: unknown) => e);
    expect(seen).toEqual(["first"]);
    expect((err as Error).name).toBe("TimeoutError");
  });
});

describe("timeout — idle", () => {
  const enc = new TextEncoder();
  /** A body that sends `count` chunks `every` ms apart, then closes — or stalls if `stallAfter` is set. */
  const drip = (count: number, every: number, stallAfter?: number) =>
    (() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              for (let i = 0; i < count; i++) {
                await new Promise((r) => setTimeout(r, every));
                controller.enqueue(enc.encode(`data: ${i}\n\n`));
                if (stallAfter !== undefined && i + 1 >= stallAfter) return;
              }
              controller.close();
            },
          }),
        ),
      )) as unknown as typeof fetch;

  it("keeps a stream that is still flowing, however long it runs", async () => {
    const api = arthron({
      baseURL: "https://a",
      fetch: drip(10, 10),
      use: [timeout(Number.POSITIVE_INFINITY, { idle: 40 })],
    });
    let events = 0;
    for await (const _ of api.get("/s").sse()) events += 1;
    expect(events).toBe(10);
  });
  it("aborts once no data has arrived for `idle` ms", async () => {
    const api = arthron({
      baseURL: "https://a",
      fetch: drip(10, 5, 2),
      use: [timeout(Number.POSITIVE_INFINITY, { idle: 30 })],
    });
    let events = 0;
    const err = await (async () => {
      for await (const _ of api.get("/s").sse()) events += 1;
    })().catch((e: unknown) => e);
    expect(events).toBe(2);
    expect((err as Error).name).toBe("TimeoutError");
  });
  it("counts the wait for headers as idle time too", async () => {
    const api = arthron({
      baseURL: "https://a",
      fetch: hangingFetch(),
      use: [timeout(Number.POSITIVE_INFINITY, { idle: 20 })],
    });
    await expect(api.get("/u")).rejects.toMatchObject({ name: "TimeoutError" });
  });
  it("rejects a bad idle value when the plugin is created", () => {
    expect(() => timeout(1000, { idle: -1 })).toThrow(TypeError);
  });
});

describe("timeout — clone() keeps the fetched fields", () => {
  it("url, redirected and type survive res.clone()", async () => {
    const fetched = Object.defineProperties(jsonResponse({}), {
      url: { value: "https://a/final" },
      redirected: { value: true },
      type: { value: "basic" },
    });
    const api = arthron({
      baseURL: "https://a",
      fetch: fakeFetch(fetched),
      use: [timeout(1000)],
    });
    const copy = (await api.get("/start")).clone();
    expect([copy.url, copy.redirected, copy.type]).toEqual([
      "https://a/final",
      true,
      "basic",
    ]);
    await copy.text();
  });
});
