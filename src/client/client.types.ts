import type { Plugin } from "../types/plugin.types";
import type { ArthronMeta, QueryParams } from "../types/request.types";
import type {
  DescriptionExtractor,
  ResponsePromise,
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
  /**
   * Per-call headers: anything fetch's `headers` takes, or a record whose
   * `null`/`undefined` values drop a client default. Not typed with
   * `HeadersInit`: that name exists only in the DOM lib, and a Node project
   * typed with `@types/node` alone does not have it.
   */
  headers?: RequestInit["headers"] | Record<string, string | null | undefined>;
  /**
   * The query string: `null`/`undefined` values are skipped, an array becomes
   * repeated keys (`ids=1&ids=2`), and a `URLSearchParams` is used as is.
   */
  queryParams?: QueryParams;
  /**
   * Values for `{name}` placeholders in the path, each encoded into its own
   * segment: `get("/users/{id}", { pathParams: { id } })`. Interpolating ids
   * into the path string yourself lets "../" or "?" escape the segment.
   */
  pathParams?: Record<string, string | number>;
  /** Settings for plugins on this call only (see `ArthronMeta`). Not sent. */
  meta?: ArthronMeta;
  /** Which non-ok responses reject on this call; overrides the client's `throwOn`. */
  throwOn?: (res: Response) => boolean;
}

/** `request()`'s options: any method, with the same body rules as `post`. */
export interface RequestOptionsWithMethod extends RequestOptions {
  method: HttpMethod;
  body?: unknown;
}

/**
 * Client options. Besides arthron's own keys it takes any fetch option as a
 * default (`credentials`, `cache`, `redirect`, `mode`, …), flat like per-call
 * options; a per-call value wins. Left out: what only makes sense per call —
 * `body`, `method`, `signal` (one client-wide signal, once aborted, would
 * fail every later call) and `window`. `headers` has its own merge rules.
 */
export interface ArthronClientOptions
  extends Omit<
    RequestInit,
    "body" | "method" | "headers" | "signal" | "window"
  > {
  /** Prefix for relative paths. Without it only absolute URLs are accepted. */
  baseURL?: string;
  /**
   * Origins an absolute URL may go to besides `baseURL`'s, as URLs of which
   * only the origin counts: `["https://cdn.example.com"]`. Any other origin
   * is a TypeError, so a path from user input or an API response cannot send
   * requests elsewhere. Config `headers` go to `baseURL`'s origin only, never
   * to these — calls there carry per-call headers alone. Without a
   * `baseURL` this list alone limits absolute URLs, and config `headers`
   * are refused (they would have nowhere to go); with neither, any http(s)
   * URL goes, config headers included.
   */
  allowedOrigins?: readonly string[];
  /**
   * Default headers, sent to baseURL's origin only: anything fetch's
   * `headers` takes, or a record. Per-call headers win, compared
   * case-insensitively; `extend` can drop one with `null`.
   */
  headers?: RequestInit["headers"] | Record<string, string | null | undefined>;
  /**
   * The function requests are sent with: anything with fetch's signature,
   * `(input, init) => Promise<Response>`. Default: the global `fetch`, read
   * per call. Pass a fake in tests, a polyfill, or a framework's fetch
   * (SvelteKit's `event.fetch`). Plugins see it as `ctx.fetchFn`.
   */
  fetchFn?: typeof fetch;
  /**
   * Plugins, outermost first. One with the pluginName of an earlier one
   * replaces it in place.
   */
  plugins?: readonly Plugin[];
  /**
   * Extracts `ArthronError.description` from a failed response's payload, for
   * an API that puts it somewhere else:
   * `(payload) => (payload as { errors?: { msg?: string }[] }).errors?.[0]?.msg`.
   * Called only for failed responses; if it throws, the error simply has no
   * description. Default: the payload's `message`, else `error` (a string),
   * else `error.message`, else `detail`.
   */
  extractDescription?: DescriptionExtractor;
  /**
   * Which non-ok responses reject with an ArthronError — return `false` to
   * get the Response instead (a 404 that is data, say). An ok response never
   * rejects. Default: every non-ok response except an opaque one
   * (`mode: "no-cors"`) and the 3xx of `redirect: "manual"`.
   */
  throwOn?: (res: Response) => boolean;
}

export interface ArthronClient {
  get(path: string, requestOptions?: RequestOptions): ResponsePromise;
  delete(path: string, requestOptions?: RequestOptions): ResponsePromise;
  head(path: string, requestOptions?: RequestOptions): ResponsePromise;
  post(
    path: string,
    body?: unknown,
    requestOptions?: RequestOptions,
  ): ResponsePromise;
  put(
    path: string,
    body?: unknown,
    requestOptions?: RequestOptions,
  ): ResponsePromise;
  patch(
    path: string,
    body?: unknown,
    requestOptions?: RequestOptions,
  ): ResponsePromise;
  /** RFC 10008 QUERY: safe and idempotent like GET, but the query travels in the body. */
  query(
    path: string,
    body?: unknown,
    requestOptions?: RequestOptions,
  ): ResponsePromise;
  /** Any method — the extension point for verbs without their own helper. */
  request(
    path: string,
    requestOptions: RequestOptionsWithMethod,
  ): ResponsePromise;
  /**
   * New client with these plugins added: a plugin replaces the one with its
   * pluginName in place; other names append. The receiver is untouched.
   */
  use(...plugins: Plugin[]): ArthronClient;
  /** New client with these options shallow-merged, headers merged, plugins added as `use` adds them. */
  extend(clientOptions: Partial<ArthronClientOptions>): ArthronClient;
  /** New client without the plugins of these pluginNames. The receiver is untouched. */
  without(...pluginNames: string[]): ArthronClient;
}

/** `ArthronClientOptions` after `resolveClientOptions`: headers as one record, plugins de-duplicated by pluginName. Internal. */
export type Resolved = Omit<ArthronClientOptions, "headers" | "plugins"> & {
  headers: Record<string, string>;
  plugins: readonly Plugin[];
};
