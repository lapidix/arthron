import { toHeaderRecord } from "../request/headers";
import type { Plugin } from "../types/plugin.types";
import type { ArthronConfig, Resolved } from "./client.types";

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

/** Normalize once so `extend` can merge headers and add plugins cheaply. */
export function resolveConfig(config: ArthronConfig): Resolved {
  const { headers, use, ...rest } = config;
  return {
    ...rest,
    headers: toHeaderRecord(headers),
    use: addPlugins([], use ?? []),
  };
}
