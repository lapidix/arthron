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
  return withFetchedFields(rebuilt, original);
}

/** Copy the fields the constructor resets — onto `clone()`s as well. */
function withFetchedFields(target: Response, from: Response): Response {
  const clone = target.clone.bind(target);
  return Object.defineProperties(target, {
    url: { value: from.url },
    redirected: { value: from.redirected },
    type: { value: from.type },
    clone: { value: () => withFetchedFields(clone(), from) },
  });
}
