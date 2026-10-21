import type { QueryParams } from "../types/request.types";

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
 * `url` as written, without its query, fragment and userinfo — for a value
 * that may not parse, or whose origin would print as "null" (ftp://…).
 */
export function withoutSecrets(url: string): string {
  return (url.split(/[?#]/)[0] ?? url).replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/\\]*@/i,
    "$1",
  );
}

/**
 * `text` with `url` redacted wherever it appears, as given or as the URL
 * parser normalizes it — for a runtime's own message that repeats the URL.
 */
export function redactUrlIn(text: string, url: string): string {
  const shown = redactUrl(url);
  let href: string | undefined;
  try {
    href = new URL(url).href;
  } catch {}
  let out = text.split(url).join(shown);
  if (href && href !== url) out = out.split(href).join(shown);
  return out;
}

/**
 * `undefined` when `url` has no origin of its own. A relative baseURL takes
 * the page's origin in a browser and has none elsewhere.
 */
export function originOf(url: string): string | undefined {
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL(url, page).origin;
  } catch {
    return undefined;
  }
}

/** The origin of an absolute http(s) URL; `undefined` for anything else. */
export function httpOrigin(url: string): string | undefined {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The origins of a list of http(s) URLs, for an option that names where
 * requests may go. An empty list or another kind of entry is a TypeError in
 * the option's own words.
 */
export function httpOrigins(
  urls: readonly string[],
  errors: { empty: string; invalid: (url: string) => string },
): Set<string> {
  if (urls.length === 0) throw new TypeError(errors.empty);
  return new Set(
    urls.map((url) => {
      const origin = httpOrigin(url);
      if (origin) return origin;
      throw new TypeError(errors.invalid(JSON.stringify(withoutSecrets(url))));
    }),
  );
}

/** `allowedOrigins` as origins, checked once when the client is created. */
export function originSet(urls: readonly string[]): Set<string> {
  return httpOrigins(urls, {
    empty:
      "arthron: allowedOrigins needs at least one URL — leave it out to stay on baseURL's origin",
    invalid: (url) =>
      `arthron: allowedOrigins needs http(s) URLs, got ${url} — e.g. allowedOrigins: ["https://cdn.example.com"]`,
  });
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
          `arthron: queryParams.${key} is not a string, number or boolean — pass one of those or an array of them (dates: date.toISOString())`,
        );
      }
      search.append(key, String(item));
    }
  }
  return search.toString();
}

/**
 * Fill `{name}` placeholders with encoded values, so each one stays inside
 * its segment: "/", "?" and "#" are encoded, and the values WHATWG URL would
 * turn into a different path — "", "." and ".." — are refused. A placeholder
 * without a value, or a value without a placeholder, is a mistake too.
 */
export function fillPath(
  template: string,
  values: Record<string, string | number>,
): string {
  const used = new Set<string>();
  const filled = template.replace(/\{([^{}/]+)\}/g, (_, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new TypeError(
        `arthron: path "${template}" has {${name}} but no value for it — pass pathParams: { ${name}: … }`,
      );
    }
    used.add(name);
    const value = String(values[name]);
    if (value === "" || value === "." || value === "..") {
      throw new TypeError(
        `arthron: pathParams.${name}=${JSON.stringify(value)} would change the path, not fill a segment — pass a real id`,
      );
    }
    return encodeURIComponent(value);
  });
  const unused = Object.keys(values).find((name) => !used.has(name));
  if (unused !== undefined) {
    throw new TypeError(
      `arthron: path "${template}" has no {${unused}} — add the placeholder or drop the value`,
    );
  }
  return filled;
}

/**
 * Join `baseURL` and `path` by plain string concatenation so a path prefix in
 * the base (`/v1`) survives a leading slash in the path. WHATWG `new URL()`
 * would drop it. An absolute path replaces the base only when it stays on the
 * base's origin or goes to one in `allowed` (`allowedOrigins`) — a path built
 * from user input or an API response must not carry the client's
 * credentials somewhere else. Without a baseURL, `allowed` alone limits it.
 */
export function resolveUrl(
  baseURL: string | undefined,
  path: string,
  params?: QueryParams,
  allowed?: ReadonlySet<string>,
): string {
  let url: string;
  if (isAbsoluteUrl(path)) {
    if (!HTTP_URL.test(path)) {
      const scheme = path.slice(0, path.indexOf(":") + 1);
      throw new TypeError(
        `arthron: only http(s) URLs can be requested, got a "${scheme}" URL — use an http:// or https:// URL`,
      );
    }
    const target = originOf(path);
    // Left to fetch when nothing limits where requests go: it fails, and
    // send turns that into an argument error.
    if (target === undefined && (baseURL !== undefined || allowed)) {
      throw new TypeError(
        `arthron: "${withoutSecrets(path)}" is not a valid URL — check it, or pass a path relative to baseURL`,
      );
    }
    const listed = target !== undefined && allowed?.has(target) === true;
    if (!listed && leavesBase(baseURL, path)) {
      const base =
        (baseURL && originOf(baseURL)) ?? withoutSecrets(baseURL ?? "");
      throw new TypeError(
        `arthron: ${target} is outside baseURL ${base} — pass a path relative to baseURL, or add ${target} to arthron({ allowedOrigins }) (config headers are not sent there)`,
      );
    }
    if (!listed && baseURL === undefined && allowed) {
      throw new TypeError(
        `arthron: ${target} is not in allowedOrigins — add it to arthron({ allowedOrigins }) or request a listed origin`,
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
