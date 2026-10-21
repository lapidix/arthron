import { type ArthronError, isArthronError } from "../../error/arthron-error";
import { isReadableStream } from "../../request/body";
import type { Plugin } from "../../types/plugin.types";
import type { RetryOptions } from "../../types/request.types";

const DEFAULT_STATUSES = [408, 429, 500, 502, 503, 504] as const;
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

type Sleep = (ms: number, signal?: AbortSignal | null) => Promise<void>;

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
 * `delayFn`'s answer, checked: setTimeout fires at once for NaN and
 * negatives, so a 1.x `delay` moved over with its arguments swapped would
 * retry in a tight loop.
 */
function checkedDelay(ms: unknown): number {
  if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) return ms;
  const shown = typeof ms === "string" ? JSON.stringify(ms) : String(ms);
  throw new TypeError(
    `arthron: retry's delayFn returned ${shown} — return the wait in ms, a finite number ≥ 0`,
  );
}

/** The rule without `shouldRetry`: a network error or a status in `statuses`, on a method in `methods`. */
function byDefault(
  thrown: unknown,
  method: string,
  settings: Settings,
): boolean {
  if (!settings.allowed.has(method) || !isArthronError(thrown)) return false;
  return thrown.status === 0 || settings.statuses.includes(thrown.status);
}

/** `RetryOptions` with defaults filled in, ready for one call. */
type Settings = {
  retries: number;
  statuses: readonly number[];
  allowed: Set<string>;
  delayFn: (retry: number, error: unknown) => number;
  maxRetryAfter: number;
  shouldRetry: RetryOptions["shouldRetry"];
  onRetry: RetryOptions["onRetry"];
};

/** 1.x options and what replaced them: unknown keys would be ignored. */
const REPLACED = { delay: "delayFn", retryOn: "statuses" } as const;

/** Defaults filled in and `retries` checked — `attempt >= NaN` is never true, so an unset env var would retry forever. */
function settle(
  options: RetryOptions,
  where: "retry()" | "meta.retry",
): Settings {
  const given = options as Record<string, unknown>;
  for (const [old, now] of Object.entries(REPLACED)) {
    if (given[old] !== undefined) {
      const fix =
        where === "meta.retry"
          ? `meta: { retry: { ${now} } }`
          : `retry({ ${now} })`;
      throw new TypeError(
        `arthron: ${where} ${old} was replaced by ${now} in 2.0 — pass ${fix}`,
      );
    }
  }
  // Ignored, a test that injected it would wait for real.
  if (given.sleep !== undefined) {
    throw new TypeError(
      `arthron: ${where} sleep left the public options in 2.0 — use fake timers in tests (vi.useFakeTimers())`,
    );
  }
  const {
    retries = 2,
    statuses = DEFAULT_STATUSES,
    methods = DEFAULT_METHODS,
    delayFn = (retry) => Math.random() * 300 * 2 ** retry,
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
    statuses,
    allowed,
    delayFn,
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
  return retryWith(options, defaultSleep);
}

/** `retry()` with the wait injected — for this package's tests; `arthron/plugins` does not export it. */
export function retryWith(options: RetryOptions, sleep: Sleep): Plugin {
  const base = settle(options, "retry()");

  return {
    pluginName: "retry",
    middleware: async (ctx, next) => {
      const override = ctx.meta?.retry;
      if (override === false) return next(ctx);
      const settings = override
        ? settle({ ...options, ...override }, "meta.retry")
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
            retryAfter ?? checkedDelay(settings.delayFn(attempt, thrown)),
            MAX_TIMER_MS,
          );
          settings.onRetry?.(thrown, attempt, wait);
          await sleep(wait, ctx.init.signal);
        }
      }
    },
  };
}
