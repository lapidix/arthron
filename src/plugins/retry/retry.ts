import { type ArthronError, isArthronError } from "../../error/arthron-error";
import { isReadableStream } from "../../request/body";
import type { Plugin } from "../../types/plugin.types";
import type { RetryOptions } from "../../types/request.types";

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

/** The rule without `shouldRetry`: a network error or a `retryOn` status, on a method in `methods`. */
function byDefault(
  thrown: unknown,
  method: string,
  settings: Settings,
): boolean {
  if (!settings.allowed.has(method) || !isArthronError(thrown)) return false;
  return thrown.status === 0 || settings.retryOn.includes(thrown.status);
}

/** `RetryOptions` with defaults filled in, ready for one call. */
type Settings = {
  retries: number;
  retryOn: readonly number[];
  allowed: Set<string>;
  delay: (retry: number, error: unknown) => number;
  maxRetryAfter: number;
  shouldRetry: RetryOptions["shouldRetry"];
  onRetry: RetryOptions["onRetry"];
};

/** Defaults filled in and `retries` checked — `attempt >= NaN` is never true, so an unset env var would retry forever. */
function settle(options: Omit<RetryOptions, "sleep">, where: string): Settings {
  const {
    retries = 2,
    retryOn = DEFAULT_RETRY_ON,
    methods = DEFAULT_METHODS,
    delay = (retry) => Math.random() * 300 * 2 ** retry,
    maxRetryAfter = DEFAULT_MAX_RETRY_AFTER,
    shouldRetry,
    onRetry,
  } = options;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError(
      `arthron: ${where} retries: ${retries} needs a whole number ≥ 0 — e.g. retries: 2`,
    );
  }
  const allowed = new Set(methods.map((m) => m.toUpperCase()));
  return {
    retries,
    retryOn,
    allowed,
    delay,
    maxRetryAfter,
    shouldRetry,
    onRetry,
  };
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
      const settings = override
        ? settle({ ...rest, ...override }, "meta.retry")
        : base;
      const method = (ctx.init.method ?? "GET").toUpperCase();
      const resendable = !isReadableStream(ctx.init.body);

      for (let attempt = 0; ; attempt += 1) {
        try {
          return await next(ctx);
        } catch (thrown) {
          // Not even shouldRetry can lift these.
          if (!resendable || attempt >= settings.retries) throw thrown;
          if (ctx.init.signal?.aborted) throw thrown;
          const verdict = settings.shouldRetry?.(thrown, attempt, ctx);
          if (verdict === false) throw thrown;
          if (verdict === undefined && !byDefault(thrown, method, settings)) {
            throw thrown;
          }
          const retryAfter = isArthronError(thrown)
            ? retryAfterMs(thrown)
            : undefined;
          if (retryAfter !== undefined && retryAfter > settings.maxRetryAfter) {
            throw thrown;
          }
          const wait = Math.min(
            retryAfter ?? settings.delay(attempt, thrown),
            MAX_TIMER_MS,
          );
          settings.onRetry?.(thrown, attempt, wait);
          await sleep(wait, ctx.init.signal);
        }
      }
    },
  };
}
