import { toHeaderRecord } from "../request/headers";
import type { Plugin } from "../types/plugin.types";
import type { ArthronConfig, FetchDefaults, Resolved } from "./client.types";

/**
 * Config keys that configure arthron itself; every other key is a fetch
 * default. Typed so that a new config key fails to compile until it is
 * listed here — otherwise it would be sent to fetch.
 */
const OWN_KEYS: Record<
  Exclude<keyof ArthronConfig, keyof FetchDefaults>,
  true
> = {
  baseURL: true,
  allowAbsoluteUrls: true,
  headers: true,
  fetch: true,
  use: true,
  errorMessage: true,
  throwOn: true,
};

/** Fields that belong to one request, refused as client defaults. */
const PER_CALL_ONLY = ["signal", "body", "method"] as const;

/**
 * Add plugins to a list. A named plugin takes the place of the one already
 * there with that name — same position, so a replaced `logging()` stays
 * outermost and a second `retry()` does not multiply attempts. Unnamed
 * plugins append.
 */
export function addPlugins(
  base: readonly Plugin[],
  added: readonly Plugin[],
): Plugin[] {
  const out = [...base];
  for (const plugin of added) {
    const at =
      plugin.name === undefined
        ? -1
        : out.findIndex((p) => p.name === plugin.name);
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
export function resolveConfig(config: ArthronConfig): Resolved {
  for (const key of PER_CALL_ONLY) {
    if ((config as Record<string, unknown>)[key] !== undefined) {
      throw new TypeError(
        `arthron: ${key} cannot be a client default, it belongs to one request — pass it per call (api.get(path, { signal }), api.post(path, body), api.request(path, { method }))`,
      );
    }
  }
  const { headers, use, ...rest } = config;
  return {
    ...rest,
    headers: toHeaderRecord(headers),
    use: addPlugins([], use ?? []),
  };
}
