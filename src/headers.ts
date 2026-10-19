/**
 * Headers as config and per-call options accept them: any `HeadersInit`, or a
 * plain object whose `null`/`undefined` values delete that header from the
 * layer underneath (a client default, an inherited header).
 */
export type HeadersOption =
  | HeadersInit
  | Record<string, string | null | undefined>;

const isPlainRecord = (
  headers: HeadersOption,
): headers is Record<string, string | null | undefined> =>
  !Array.isArray(headers) &&
  Object.prototype.toString.call(headers) !== "[object Headers]";

/**
 * Layer header sets left to right into one plain record. Names are compared
 * case-insensitively and come back lowercased; a later layer wins, so a
 * caller's `content-type` replaces a default `Content-Type` instead of fetch
 * sending both values joined. `Headers` validates every value it sets.
 */
export function mergeHeaders(
  ...layers: (HeadersOption | undefined)[]
): Record<string, string> {
  const merged = new Headers();
  for (const layer of layers) {
    if (!layer) continue;
    if (isPlainRecord(layer)) {
      for (const [name, value] of Object.entries(layer)) {
        if (value == null) merged.delete(name);
        else merged.set(name, value);
      }
    } else {
      for (const [name, value] of new Headers(layer)) merged.set(name, value);
    }
  }
  return Object.fromEntries(merged);
}

/** Normalize any header shape into a plain record with lowercased names. */
export function toHeaderRecord(
  headers: HeadersOption | undefined,
): Record<string, string> {
  return mergeHeaders(headers);
}
