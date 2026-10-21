import { checkPlugin } from "../pipeline/create-plugin";
import { toHeaderRecord } from "../request/headers";
import { httpOrigin, withoutSecrets } from "../request/url";
import type { Plugin } from "../types/plugin.types";
import type {
  ArthronClientOptions,
  FetchDefaults,
  Resolved,
} from "./client.types";

/**
 * Config keys that configure arthron itself; every other key is a fetch
 * default. Typed so that a new config key fails to compile until it is
 * listed here — otherwise it would be sent to fetch.
 */
const OWN_KEYS: Record<
  Exclude<keyof ArthronClientOptions, keyof FetchDefaults>,
  true
> = {
  baseURL: true,
  allowedOrigins: true,
  headers: true,
  fetchFn: true,
  plugins: true,
  extractDescription: true,
  throwOn: true,
};

/** Fields that belong to one request, refused as client defaults. */
const PER_CALL_ONLY = ["signal", "body", "method"] as const;

/**
 * 1.x config keys and what replaced them. Left alone, each would become an
 * unknown key, then a fetch default, and be ignored: plugins not applied, a
 * test's fake fetch passed over for the real network.
 */
const REPLACED = {
  fetch: "fetchFn",
  use: "plugins",
  errorDetail: "extractDescription",
  allowAbsoluteUrls: "allowedOrigins",
} as const;

/**
 * Add plugins to a list, each checked as `createPlugin` checks it. A plugin
 * takes the place of the one already there with its pluginName — same position,
 * so a replaced `logging()` stays outermost and a second `retry()` does not
 * multiply attempts. Other names append.
 */
export function addPlugins(
  base: readonly Plugin[],
  added: readonly Plugin[],
): Plugin[] {
  const out = [...base];
  for (const plugin of added) {
    checkPlugin(plugin);
    const at = out.findIndex((p) => p.pluginName === plugin.pluginName);
    if (at === -1) out.push(plugin);
    else out[at] = plugin;
  }
  return out;
}

/** The fetch defaults in a config: every set key that is not arthron's own. */
export function fetchDefaults(config: Resolved): FetchDefaults {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) => value !== undefined && !(key in OWN_KEYS),
    ),
  ) as FetchDefaults;
}

/** Normalize once so `extend` can merge headers and add plugins cheaply. */
export function resolveConfig(config: ArthronClientOptions): Resolved {
  for (const key of PER_CALL_ONLY) {
    if ((config as Record<string, unknown>)[key] !== undefined) {
      throw new TypeError(
        `arthron: ${key} cannot be a client default, it belongs to one request — pass it per call (api.get(path, { signal }), api.post(path, body), api.request(path, { method }))`,
      );
    }
  }
  for (const [old, now] of Object.entries(REPLACED)) {
    if ((config as Record<string, unknown>)[old] !== undefined) {
      throw new TypeError(
        `arthron: the ${old} option was replaced by ${now} in 2.0 — pass arthron({ ${now} })`,
      );
    }
  }
  const { headers, plugins, allowedOrigins, ...rest } = config;
  if (rest.fetchFn !== undefined && typeof rest.fetchFn !== "function") {
    throw new TypeError(
      `arthron: fetchFn must be a function with fetch's signature, got ${kindOf(rest.fetchFn)} — e.g. arthron({ fetchFn: fetch })`,
    );
  }
  if (rest.baseURL !== undefined) checkBaseURL(rest.baseURL);
  if (allowedOrigins !== undefined && !Array.isArray(allowedOrigins)) {
    throw new TypeError(
      `arthron: allowedOrigins takes a list of URLs, got ${kindOf(allowedOrigins)} — e.g. allowedOrigins: ["https://cdn.example.com"]`,
    );
  }
  const record = toHeaderRecord(headers);
  // Config headers belong to baseURL's origin, never to a listed one; a
  // client with a list and no baseURL would have nowhere to send them.
  if (
    rest.baseURL === undefined &&
    allowedOrigins !== undefined &&
    allowedOrigins.length > 0 &&
    Object.keys(record).length > 0
  ) {
    throw new TypeError(
      "arthron: config headers go to baseURL's origin only, and this client has allowedOrigins but no baseURL — set baseURL, or pass these headers per call",
    );
  }
  const resolved: Resolved = {
    ...rest,
    headers: record,
    plugins: addPlugins([], plugins ?? []),
  };
  // A copy: the caller's array, pushed to later, must not widen a client
  // derived from this one.
  if (allowedOrigins !== undefined)
    resolved.allowedOrigins = [...allowedOrigins];
  return resolved;
}

/** "a string", "an object", "null" — for messages about a value of the wrong kind. */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}

/**
 * An http(s) baseURL must name a host. `https://${HOST}/api` with HOST unset
 * is "https:///api", which a URL parser reads as host "api" — and a relative
 * path appended to "https://" chooses the host itself.
 */
function checkBaseURL(baseURL: string): void {
  if (!/^https?:\/\//i.test(baseURL)) return;
  if (!/^https?:\/\/(?:[/\\?#]|$)/i.test(baseURL) && httpOrigin(baseURL)) {
    return;
  }
  throw new TypeError(
    `arthron: baseURL "${withoutSecrets(baseURL)}" has no host — pass a full URL such as "https://api.example.com" (an unset environment variable?)`,
  );
}
