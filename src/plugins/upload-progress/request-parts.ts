/**
 * What a transport needs from fetch's arguments, in any shape a plugin
 * wrapping it may pass: arthron sends a URL string and a lowercase header
 * record, a wrapper may pass a Request, a URL or Headers.
 */
export const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

/** A Request's headers, then init's on top, as one lowercase record. */
export function headersOf(
  input: RequestInfo | URL,
  init: RequestInit,
): Record<string, string> {
  const merged = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  for (const [name, value] of new Headers(init.headers))
    merged.set(name, value);
  return Object.fromEntries(merged);
}
