/*
 * RetryOptions and TimeoutOptions live here rather than with their plugins:
 * ArthronMeta names both, and RequestContext → ArthronMeta → RetryOptions →
 * RequestContext is one cycle of types. Adding them to ArthronMeta by
 * declaration merging from a separate file would break that cycle, but the
 * merge does not survive the bundled .d.ts.
 */

/**
 * What plugins see and return. `init.headers` is always a plain record with
 * lowercased names — spread it, read it, add to it — and the pipeline puts
 * it back into that shape after every request interceptor.
 */
export interface RequestContext {
  url: string;
  init: Omit<RequestInit, "headers"> & { headers: Record<string, string> };
  /** Per-call settings for plugins (`RequestOptions.meta`); never sent. */
  meta: ArthronMeta;
  /**
   * The function this attempt is sent with — the client's `fetchFn` at first,
   * else the global `fetch`. A plugin may replace it for this attempt
   * (`uploadProgress()` sends over XMLHttpRequest) or wrap it to observe.
   * Always set on contexts arthron creates; optional so a context you build
   * yourself stays valid.
   */
  fetchFn?: typeof fetch;
}

/**
 * Per-call settings for plugins, passed as `api.get(path, { meta })` and
 * carried next to `init` — never sent to fetch. Each built-in plugin reads
 * the key named after it — `bearerAuth`, `retry`, `timeout`,
 * `uploadProgress`; your own add keys by augmentation:
 *
 * ```ts
 * declare module "arthron" {
 *   interface ArthronMeta { skipTrace?: boolean }
 * }
 * ```
 */
export interface ArthronMeta {
  /**
   * `false` sends this call without the `bearerAuth()` token and never refreshes
   * on its 401 — for the login and token-refresh endpoints.
   */
  bearerAuth?: false;
  /**
   * Upload progress for this call, with `uploadProgress()` on the client.
   * Never called without that plugin or without a body, nor where progress
   * cannot be had: a client with an injected `fetch`, another plugin's
   * `fetchFn`, Deno, Bun, Cloudflare Workers, a service worker, or a
   * `ReadableStream` body in a browser — those calls are sent as usual.
   */
  uploadProgress?: (event: UploadProgressEvent) => void;
  /** `false` turns `retry()` off for this call; an object overrides its options. */
  retry?: false | RetryOptions;
  /**
   * `false` lifts `timeout()`'s deadlines for this call; a number replaces
   * its `total` (ms); an object overrides the parts it sets, `total` or
   * `idle`: `{ idle: 30_000 }` keeps the configured total.
   */
  timeout?: false | number | TimeoutOptions;
}

export type TimeoutOptions = {
  /**
   * Abort after this many ms in all, counted until the body has been fully
   * read — the same deadline as `timeout(ms)`. Default: none.
   */
  total?: number;
  /**
   * Abort when no data has arrived for this many ms — while waiting for the
   * headers and between body chunks. Unlike `total`, a stream that keeps
   * flowing is never cut off: `timeout({ idle: 30_000 })`.
   */
  idle?: number;
};

/** One step of an upload, as `meta.uploadProgress` receives it. */
export type UploadProgressEvent = {
  /** Bytes sent so far. */
  loaded: number;
  /** Bytes in the whole body; `undefined` when it cannot be known (a stream without content-length). */
  total: number | undefined;
  /**
   * `loaded / total`, a fraction from 0 to 1 — not a percentage: multiply
   * by 100 for one. `undefined` when `total` is.
   */
  fraction: number | undefined;
};

export type RetryOptions = {
  /** Number of retries after the first attempt. Default 2 (3 requests total). */
  retries?: number;
  /** Statuses worth retrying. Default 408, 429, 500, 502, 503, 504; network errors (status 0) always are. */
  statuses?: readonly number[];
  /**
   * Methods safe to repeat (QUERY is, per RFC 10008). Compared
   * case-insensitively. Default GET, HEAD, OPTIONS, QUERY, PUT, DELETE.
   */
  methods?: readonly string[];
  /**
   * Returns the wait in ms before the next attempt. `attempt` is 0-based: 0
   * after the first request failed. Default "full jitter": a random share
   * of 300 · 2^attempt, so clients that failed together do not retry
   * together. A `Retry-After` header wins over it. Must return a finite
   * number ≥ 0, or the call rejects with a TypeError.
   */
  delayFn?: (attempt: number, error: unknown) => number;
  /**
   * Your own verdict on one failure (`attempt` 0-based, as for `delayFn`):
   * `true` retries, `false` stops, `undefined` leaves it to
   * `statuses`/`methods`. It sees every error — a TimeoutError from a
   * `timeout()` placed after `retry()` included — but cannot exceed
   * `retries`, resend a `ReadableStream` body, retry a call the caller
   * aborted, or wait out a `Retry-After` longer than `maxRetryAfter`.
   */
  shouldRetry?: (
    error: unknown,
    attempt: number,
    ctx: RequestContext,
  ) => boolean | undefined;
  /**
   * Called before each wait, for logs and metrics, with the same 0-based
   * `attempt` and the `delay` in ms about to be waited.
   */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /**
   * Longest `Retry-After` (ms) worth honouring. Beyond it the request is not
   * retried at all. Default 60 000.
   */
  maxRetryAfter?: number;
};

/**
 * Query parameters. `null`/`undefined` values are skipped, an array becomes
 * repeated keys (`ids=1&ids=2`), and a `URLSearchParams` is used as is.
 */
export type QueryParams =
  | Record<
      string,
      | string
      | number
      | boolean
      | null
      | undefined
      | readonly (string | number | boolean | null | undefined)[]
    >
  | URLSearchParams;
