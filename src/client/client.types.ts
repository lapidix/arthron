import type { Plugin } from "../types/plugin.types";
import type {
  ArthronMeta,
  HeadersOption,
  QueryParams,
} from "../types/request.types";
import type {
  ArthronPromise,
  ErrorDetailResolver,
} from "../types/response.types";

/**
 * The methods arthron knows by name; any other string is sent as written.
 * The standard ones go out uppercased whatever their case — fetch itself
 * only normalizes six of them, so a lowercase "patch" would draw a 405.
 */
export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "QUERY"
  | (string & {});

/**
 * Per-call options. Public types are interfaces, so a plugin package can add
 * its own options by augmentation (`declare module "arthron"`).
 */
export interface RequestOptions
  extends Omit<RequestInit, "body" | "method" | "headers"> {
  /** Per-call headers; a `null`/`undefined` value drops a client default. */
  headers?: HeadersOption;
  params?: QueryParams;
  /**
   * Values for `{name}` placeholders in the path, each encoded into its own
   * segment: `get("/users/{id}", { path: { id } })`. Interpolating ids into
   * the path string yourself lets "../" or "?" escape the segment.
   */
  path?: Record<string, string | number>;
  /** Settings for plugins on this call only (see `ArthronMeta`). Not sent. */
  meta?: ArthronMeta;
  /** Which non-ok responses reject on this call; overrides the client's `throwOn`. */
  throwOn?: (res: Response) => boolean;
}

/** `request()`'s options: any method, with the same body rules as `post`. */
export interface RequestInitWithBody extends RequestOptions {
  method: HttpMethod;
  body?: unknown;
}

/**
 * The fetch options a client can set as defaults: the same `RequestInit`
 * fields per-call options take, minus what only makes sense per call —
 * `body`, `method`, `signal` (one client-wide signal, once aborted, would
 * fail every later call) and `window`. `headers` has its own merge rules.
 */
export type FetchDefaults = Omit<
  RequestInit,
  "body" | "method" | "headers" | "signal" | "window"
>;

/**
 * Client config. Besides arthron's own keys it takes any fetch option as a
 * default (`credentials`, `cache`, `redirect`, `mode`, …), flat like per-call
 * options; a per-call value wins.
 */
export interface ArthronConfig extends FetchDefaults {
  /** Prefix for relative paths. Without it only absolute URLs are accepted. */
  baseURL?: string;
  /**
   * Origins an absolute URL may go to besides `baseURL`'s, as URLs of which
   * only the origin counts: `["https://cdn.example.com"]`. Any other origin
   * is a TypeError, so a path from user input or an API response cannot send
   * requests elsewhere, and config `headers` go to `baseURL`'s origin only,
   * never to these. Without a `baseURL` this list alone limits absolute
   * URLs; with neither, any http(s) URL goes.
   */
  allowedOrigins?: readonly string[];
  /** Default headers. Per-call headers win, compared case-insensitively; `extend` can drop one with `null`. */
  headers?: HeadersOption;
  /** Injection point for tests and polyfills. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  use?: Plugin[];
  /** How to pick a message out of an error body. */
  errorDetail?: ErrorDetailResolver;
  /**
   * Which non-ok responses reject with an ArthronError — return `false` to
   * get the Response instead (a 404 that is data, say). An ok response never
   * rejects. Default: every non-ok response except an opaque one
   * (`mode: "no-cors"`) and the 3xx of `redirect: "manual"`.
   */
  throwOn?: (res: Response) => boolean;
}

export interface Arthron {
  get(path: string, init?: RequestOptions): ArthronPromise;
  delete(path: string, init?: RequestOptions): ArthronPromise;
  head(path: string, init?: RequestOptions): ArthronPromise;
  post(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  put(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  patch(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  /** RFC 10008 QUERY: safe and idempotent like GET, but the query travels in the body. */
  query(path: string, body?: unknown, init?: RequestOptions): ArthronPromise;
  /** Any method — the extension point for verbs without their own helper. */
  request(path: string, init: RequestInitWithBody): ArthronPromise;
  /**
   * New client with these plugins added: a named one replaces the plugin of
   * that name in place, an unnamed one appends. The receiver is untouched.
   */
  use(...plugins: Plugin[]): Arthron;
  /** New client with config shallow-merged, headers merged, plugins added as `use` adds them. */
  extend(config: Partial<ArthronConfig>): Arthron;
  /** New client without the plugins of these names. The receiver is untouched. */
  without(...names: string[]): Arthron;
}

/** `ArthronConfig` after `resolveConfig`: headers as one record, plugins de-duplicated by name. Internal. */
export type Resolved = Omit<ArthronConfig, "headers" | "use"> & {
  headers: Record<string, string>;
  use: readonly Plugin[];
};
