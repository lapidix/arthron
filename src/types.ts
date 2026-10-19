import type { ArthronError, ErrorMessageResolver } from "./error";
import type { SseEvent } from "./stream";
import type { QueryParams } from "./url";

export type { ErrorMessageResolver } from "./error";
export type { SseEvent } from "./stream";
export type { QueryParams } from "./url";

export type RequestContext = { url: string; init: RequestInit };

/** Runs before each attempt. Returns the context to send (may be a new object). */
export type RequestInterceptor = (
  ctx: RequestContext,
) => RequestContext | Promise<RequestContext>;

/** Runs after a successful attempt. The body is single-use — `clone()` to peek. */
export type ResponseInterceptor = (
  res: Response,
  ctx: RequestContext,
) => Response | Promise<Response>;

/** Runs after a failed attempt. Returns the error to throw; it is always thrown. */
export type ErrorInterceptor = (
  err: ArthronError,
  ctx: RequestContext,
) => ArthronError | Promise<ArthronError>;

/**
 * Wraps the whole call. `next` runs everything below it (request interceptors →
 * fetch → response/error interceptors) and may be called again to retry.
 * `next` rejects with an `ArthronError`, or with the untouched original when the
 * failure was a cancellation or a bug in a plugin.
 */
export type Middleware = (
  ctx: RequestContext,
  next: (ctx: RequestContext) => Promise<Response>,
) => Promise<Response>;

export type Plugin = {
  /** For logs and debugging only. */
  name?: string;
  middleware?: Middleware;
  request?: RequestInterceptor;
  response?: ResponseInterceptor;
  error?: ErrorInterceptor;
};

export type RequestOptions = Omit<RequestInit, "body" | "method"> & {
  params?: QueryParams;
};

export type RequestInitWithBody = RequestOptions & {
  method: string;
  body?: unknown;
};

export type ArthronConfig = {
  /** Prefix for relative paths. Without it only absolute URLs are accepted. */
  baseURL?: string;
  /** Default headers. Per-call headers win, compared case-insensitively. */
  headers?: HeadersInit;
  /** Forwarded to fetch as-is. Not set unless you set it. */
  credentials?: RequestCredentials;
  /** Injection point for tests and polyfills. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  use?: Plugin[];
  /** How to pick a message out of an error body. */
  errorMessage?: ErrorMessageResolver;
};

export type ArthronPromise = Promise<Response> & {
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
  /** Iterate a `text/event-stream` body as events. */
  sse(): AsyncIterable<SseEvent>;
  /** Iterate a newline-delimited JSON body, one parsed value per line. */
  ndjson<T = unknown>(): AsyncIterable<T>;
};

export type Arthron = {
  get(path: string, init?: RequestOptions): ArthronPromise;
  delete(path: string, init?: RequestOptions): ArthronPromise;
  head(path: string, init?: RequestOptions): ArthronPromise;
  post(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  put(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  patch(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  request(path: string, init: RequestInitWithBody): ArthronPromise;
  /** New client with these plugins appended. The receiver is untouched. */
  use(...plugins: Plugin[]): Arthron;
  /** New client with config shallow-merged, headers merged, plugins appended. */
  extend(config: Partial<ArthronConfig>): Arthron;
};
