type QueryValue = string | number | boolean | null | undefined;

/**
 * Query parameters. `null`/`undefined` values are skipped, an array becomes
 * repeated keys (`ids=1&ids=2`), and a `URLSearchParams` is used as is.
 */
export type QueryParams =
  | Record<string, QueryValue | readonly QueryValue[]>
  | URLSearchParams;

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const HTTP_URL = /^https?:\/\//i;

export function isAbsoluteUrl(path: string): boolean {
  return ABSOLUTE_URL.test(path);
}

/**
 * Origin + pathname only — the query and userinfo tend to carry secrets.
 * For anything printed: log lines, error messages, `ArthronError.toJSON`.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/**
 * `undefined` when `url` has no origin of its own. A relative baseURL takes
 * the page's origin in a browser and has none elsewhere.
 */
function originOf(url: string): string | undefined {
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL(url, page).origin;
  } catch {
    return undefined;
  }
}

/** `path` is absolute and points away from `baseURL`'s origin. */
export function leavesBase(baseURL: string | undefined, path: string): boolean {
  if (baseURL === undefined || !isAbsoluteUrl(path)) return false;
  const base = originOf(baseURL);
  return base === undefined || originOf(path) !== base;
}

function toQueryString(params: QueryParams | undefined): string {
  if (!params) return "";
  if (Object.prototype.toString.call(params) === "[object URLSearchParams]") {
    return params.toString();
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === null || item === undefined) continue;
      // `String({})` is "[object Object]" and a Date prints in local time —
      // neither is what a server expects.
      if (typeof item === "object" || typeof item === "function") {
        throw new TypeError(
          `arthron: params.${key} is not a string, number or boolean — pass one of those or an array of them (dates: date.toISOString())`,
        );
      }
      search.append(key, String(item));
    }
  }
  return search.toString();
}

/**
 * Join `baseURL` and `path` by plain string concatenation so a path prefix in
 * the base (`/v1`) survives a leading slash in the path. WHATWG `new URL()`
 * would drop it. An absolute path replaces the base only when it stays on the
 * base's origin, or when `allowAbsoluteUrls` says other origins are fine — a
 * path built from user input or an API response must not carry the client's
 * credentials somewhere else.
 */
export function resolveUrl(
  baseURL: string | undefined,
  path: string,
  params?: QueryParams,
  allowAbsoluteUrls = false,
): string {
  let url: string;
  if (isAbsoluteUrl(path)) {
    if (!HTTP_URL.test(path)) {
      const scheme = path.slice(0, path.indexOf(":") + 1);
      throw new TypeError(
        `arthron: only http(s) URLs can be requested, got a "${scheme}" URL — use an http:// or https:// URL`,
      );
    }
    if (!allowAbsoluteUrls && leavesBase(baseURL, path)) {
      throw new TypeError(
        `arthron: ${originOf(path)} is outside baseURL ${(baseURL && originOf(baseURL)) ?? baseURL} — pass a path relative to baseURL, or set arthron({ allowAbsoluteUrls: true }) to allow other origins (config headers are not sent to them)`,
      );
    }
    url = path;
  } else {
    if (baseURL === undefined) {
      throw new TypeError(
        `arthron: relative path "${redactUrl(path)}" needs a baseURL — pass baseURL in arthron({ baseURL }) or use an absolute URL`,
      );
    }
    url = `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }
  const query = toQueryString(params);
  if (!query) return url;
  // The query goes before any #fragment, or the server never sees it.
  const hash = url.indexOf("#");
  const [base, fragment] =
    hash === -1 ? [url, ""] : [url.slice(0, hash), url.slice(hash)];
  return `${base}${base.includes("?") ? "&" : "?"}${query}${fragment}`;
}
