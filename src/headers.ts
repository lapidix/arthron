/**
 * Normalize any `HeadersInit` (plain object, `Headers`, tuple array) into a
 * plain record. Keys come back lowercased — `Headers` does that for us.
 */
export function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

/**
 * Layer `override` on top of `base`. Names are compared case-insensitively and
 * the override wins, so a caller's `content-type` replaces a default
 * `Content-Type` instead of fetch sending both values joined.
 */
export function mergeHeaders(
  base: HeadersInit | undefined,
  override: HeadersInit | undefined,
): Record<string, string> {
  return { ...toHeaderRecord(base), ...toHeaderRecord(override) };
}
