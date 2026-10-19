import { type IeumError, isIeumError } from "../error";
import type { Plugin, RequestContext } from "../types";

export type RetryOptions = {
  /** Number of retries after the first attempt. Default 2 (3 requests total). */
  retries?: number;
  /** Statuses worth retrying. Network errors (status 0) always are. */
  retryOn?: readonly number[];
  /** Methods safe to repeat. Compared case-insensitively. */
  methods?: readonly string[];
  /** Backoff in ms for retry number `retry` (0-based). Default 300 · 2^retry. */
  delay?: (retry: number, error: IeumError) => number;
  /** Injectable for tests. Default `setTimeout`; rejects with the abort reason. */
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
};

const DEFAULT_RETRY_ON = [408, 429, 500, 502, 503, 504] as const;
const DEFAULT_METHODS = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"] as const;

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
function retryAfterMs(error: IeumError): number | undefined {
  const value = error.headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

function isStreamBody(ctx: RequestContext): boolean {
  return (
    typeof ReadableStream !== "undefined" &&
    ctx.init.body instanceof ReadableStream
  );
}

/**
 * Retry on network errors and the configured statuses by calling `next`
 * again — the whole attempt (request interceptors included) is re-run.
 * Only `IeumError` is considered; cancellation and plugin bugs pass through.
 */
export function retry(options: RetryOptions = {}): Plugin {
  const {
    retries = 2,
    retryOn = DEFAULT_RETRY_ON,
    methods = DEFAULT_METHODS,
    delay = (retry) => 300 * 2 ** retry,
    sleep = defaultSleep,
  } = options;
  const allowed = new Set(methods.map((m) => m.toUpperCase()));

  return {
    name: "retry",
    middleware: async (ctx, next) => {
      const method = (ctx.init.method ?? "GET").toUpperCase();
      const eligible = allowed.has(method) && !isStreamBody(ctx);

      for (let attempt = 0; ; attempt += 1) {
        try {
          return await next(ctx);
        } catch (thrown) {
          if (!eligible || attempt >= retries) throw thrown;
          if (!isIeumError(thrown)) throw thrown;
          if (thrown.status !== 0 && !retryOn.includes(thrown.status)) {
            throw thrown;
          }
          if (ctx.init.signal?.aborted) throw thrown;
          await sleep(
            retryAfterMs(thrown) ?? delay(attempt, thrown),
            ctx.init.signal,
          );
        }
      }
    },
  };
}
