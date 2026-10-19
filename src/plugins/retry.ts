import { isReadableStream } from "../body";
import { type ArthronError, isArthronError } from "../error";
import type { Plugin } from "../types";

export type RetryOptions = {
  /** Number of retries after the first attempt. Default 2 (3 requests total). */
  retries?: number;
  /** Statuses worth retrying. Network errors (status 0) always are. */
  retryOn?: readonly number[];
  /** Methods safe to repeat (QUERY is, per RFC 10008). Compared case-insensitively. */
  methods?: readonly string[];
  /** Backoff in ms for retry number `retry` (0-based). Default 300 · 2^retry. */
  delay?: (retry: number, error: ArthronError) => number;
  /** Injectable for tests. Default `setTimeout`; rejects with the abort reason. */
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  /**
   * Longest `Retry-After` (ms) worth honouring. Beyond it the request is not
   * retried at all. Default 60 000.
   */
  maxRetryAfter?: number;
};

const DEFAULT_RETRY_ON = [408, 429, 500, 502, 503, 504] as const;
const DEFAULT_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "QUERY",
  "PUT",
  "DELETE",
] as const;
const DEFAULT_MAX_RETRY_AFTER = 60_000;
/** setTimeout fires at once past this, so every wait is capped to it. */
const MAX_TIMER_MS = 2 ** 31 - 1;

function defaultSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** `Retry-After` as ms — seconds or an HTTP-date. `undefined` when absent or unparsable. */
function retryAfterMs(error: ArthronError): number | undefined {
  const value = error.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

/**
 * Retry on network errors and the configured statuses by calling `next`
 * again — the whole attempt (request interceptors included) is re-run.
 * Only `ArthronError` is considered; cancellation and plugin bugs pass through.
 */
type Settings = {
  retries: number;
  retryOn: readonly number[];
  allowed: Set<string>;
  delay: (retry: number, error: ArthronError) => number;
  maxRetryAfter: number;
};

/** Defaults filled in and `retries` checked — `attempt >= NaN` is never true, so an unset env var would retry forever. */
function settle(options: Omit<RetryOptions, "sleep">, where: string): Settings {
  const {
    retries = 2,
    retryOn = DEFAULT_RETRY_ON,
    methods = DEFAULT_METHODS,
    delay = (retry) => 300 * 2 ** retry,
    maxRetryAfter = DEFAULT_MAX_RETRY_AFTER,
  } = options;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError(
      `arthron: ${where} retries: ${retries} needs a whole number ≥ 0 — e.g. retries: 2`,
    );
  }
  const allowed = new Set(methods.map((m) => m.toUpperCase()));
  return { retries, retryOn, allowed, delay, maxRetryAfter };
}

/**
 * Retry on network errors and the configured statuses by calling `next`
 * again — the whole attempt (request interceptors included) is re-run.
 * Only `ArthronError` is considered; cancellation and plugin bugs pass through.
 * A call can turn it off or override its options with `meta.retry`.
 */
export function retry(options: RetryOptions = {}): Plugin {
  const { sleep = defaultSleep, ...rest } = options;
  const base = settle(rest, "retry()");

  return {
    name: "retry",
    middleware: async (ctx, next) => {
      const override = ctx.meta?.retry;
      if (override === false) return next(ctx);
      const { retries, retryOn, allowed, delay, maxRetryAfter } = override
        ? settle({ ...rest, ...override }, "meta.retry")
        : base;
      const method = (ctx.init.method ?? "GET").toUpperCase();
      const eligible = allowed.has(method) && !isReadableStream(ctx.init.body);

      for (let attempt = 0; ; attempt += 1) {
        try {
          return await next(ctx);
        } catch (thrown) {
          if (!eligible || attempt >= retries) throw thrown;
          if (!isArthronError(thrown)) throw thrown;
          if (thrown.status !== 0 && !retryOn.includes(thrown.status)) {
            throw thrown;
          }
          if (ctx.init.signal?.aborted) throw thrown;
          const retryAfter = retryAfterMs(thrown);
          if (retryAfter !== undefined && retryAfter > maxRetryAfter) {
            throw thrown;
          }
          const wait = retryAfter ?? delay(attempt, thrown);
          await sleep(Math.min(wait, MAX_TIMER_MS), ctx.init.signal);
        }
      }
    },
  };
}
