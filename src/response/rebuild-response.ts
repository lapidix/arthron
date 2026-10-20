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
  const { url, redirected, type } = original;
  return withFields(rebuilt, { url, redirected, type });
}

/** The fields a fetched Response has and the constructor resets. */
export type FetchedFields = Pick<Response, "url" | "redirected" | "type">;

/** Set those fields on `target` — and on its `clone()`s as well. */
export function withFields(target: Response, fields: FetchedFields): Response {
  const clone = target.clone.bind(target);
  return Object.defineProperties(target, {
    url: { value: fields.url },
    redirected: { value: fields.redirected },
    type: { value: fields.type },
    clone: { value: () => withFields(clone(), fields) },
  });
}
