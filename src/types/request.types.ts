/*
 * RetryOptions lives here rather than with the retry plugin: RequestContext →
 * ArthronMeta → RetryOptions → RequestContext is one cycle of types. Adding
 * `retry` to ArthronMeta by declaration merging from a separate file would
 * break that cycle, but the merge does not survive the bundled .d.ts.
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
  retry?: false | Omit<RetryOptions, "sleep">;
  /** Deadline for this call in ms, overriding `timeout(ms)`. `Infinity` lifts it. */
  timeout?: number;
}

/** One step of an upload, as `meta.uploadProgress` receives it. */
export type UploadProgressEvent = {
  /** Bytes sent so far. */
  loaded: number;
  /** Bytes in the whole body; `undefined` when it cannot be known (a stream without content-length). */
  total: number | undefined;
  /** `loaded / total`, from 0 to 1; `undefined` when `total` is. */
  progress: number | undefined;
};

export type RetryOptions = {
  /** Number of retries after the first attempt. Default 2 (3 requests total). */
  retries?: number;
  /** Statuses worth retrying. Network errors (status 0) always are. */
  retryOn?: readonly number[];
  /** Methods safe to repeat (QUERY is, per RFC 10008). Compared case-insensitively. */
  methods?: readonly string[];
  /**
   * Backoff in ms for retry number `retry` (0-based). Default "full jitter":
   * a random share of 300 · 2^retry, so clients that failed together do not
   * retry together.
   */
  delay?: (retry: number, error: unknown) => number;
  /**
   * Your own verdict on one failure: `true` retries, `false` stops,
   * `undefined` leaves it to `retryOn`/`methods`. It sees every error — a
   * TimeoutError from a `timeout()` placed after `retry()` included — but
   * cannot exceed `retries`, resend a `ReadableStream` body, or retry a call
   * the caller aborted.
   */
  shouldRetry?: (
    error: unknown,
    attempt: number,
    ctx: RequestContext,
  ) => boolean | undefined;
  /** Called before each wait, for logs and metrics. */
  onRetry?: (error: unknown, attempt: number, waitMs: number) => void;
  /** Injectable for tests. Default `setTimeout`; rejects with the abort reason. */
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  /**
   * Longest `Retry-After` (ms) worth honouring. Beyond it the request is not
   * retried at all. Default 60 000.
   */
  maxRetryAfter?: number;
};

type QueryValue = string | number | boolean | null | undefined;

/**
 * Query parameters. `null`/`undefined` values are skipped, an array becomes
 * repeated keys (`ids=1&ids=2`), and a `URLSearchParams` is used as is.
 */
export type QueryParams =
  | Record<string, QueryValue | readonly QueryValue[]>
  | URLSearchParams;

/**
 * Headers as config and per-call options accept them: anything fetch's
 * `headers` takes, or a plain object whose `null`/`undefined` values delete
 * that header from the layer underneath (a client default, an inherited
 * header). Not spelled `HeadersInit`: that name exists only in the DOM lib,
 * and a Node project typed with `@types/node` alone does not have it.
 */
export type HeadersOption =
  | NonNullable<RequestInit["headers"]>
  | Record<string, string | null | undefined>;
