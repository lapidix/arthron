/**
 * A new Response with `body` but everything else taken from `original`. The
 * constructor resets `url`, `redirected` and `type`, so those are copied over
 * as own properties — callers that resolve relative links or detect
 * redirects keep working.
 */
export function rebuildResponse(
  original: Response,
  body: BodyInit | null,
): Response {
  const rebuilt = new Response(body, {
    status: original.status,
    statusText: original.statusText,
    headers: original.headers,
  });
  return Object.defineProperties(rebuilt, {
    url: { value: original.url },
    redirected: { value: original.redirected },
    type: { value: original.type },
  });
}
