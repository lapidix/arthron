export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isAbsoluteUrl(path: string): boolean {
  return ABSOLUTE_URL.test(path);
}

function toQueryString(params: QueryParams | undefined): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    search.append(key, String(value));
  }
  return search.toString();
}

/**
 * Join `baseURL` and `path` by plain string concatenation so a path prefix in
 * the base (`/v1`) survives a leading slash in the path. WHATWG `new URL()`
 * would drop it. Absolute paths skip the base entirely.
 */
export function resolveUrl(
  baseURL: string | undefined,
  path: string,
  params?: QueryParams,
): string {
  let url: string;
  if (isAbsoluteUrl(path)) {
    url = path;
  } else {
    if (baseURL === undefined) {
      throw new TypeError(
        `arthron: relative path "${path}" needs a baseURL — pass baseURL in arthron({ baseURL }) or use an absolute URL`,
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
