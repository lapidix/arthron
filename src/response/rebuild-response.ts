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
  const rebuilt = createResponse(body, {
    status: original.status,
    statusText: original.statusText,
    headers: original.headers,
  });
  const { url, redirected, type } = original;
  return withFields(rebuilt, { url, redirected, type });
}

/**
 * `new Response(body, init)` for any status fetch hands over. The
 * constructor takes 200–599 only, but fetch passes on whatever a server sends
 * (LinkedIn answers bots with 999), so another status is built as 599 and set
 * back as an own `status` — never `ok`, like any status outside 200–299.
 */
export function createResponse(
  body: BodyInit | null,
  init: ResponseInit & { status: number },
): Response {
  if (init.status >= 200 && init.status <= 599) return new Response(body, init);
  return withStatus(new Response(body, { ...init, status: 599 }), init.status);
}

function withStatus(target: Response, status: number): Response {
  const clone = target.clone.bind(target);
  return Object.defineProperties(target, {
    status: { value: status },
    ok: { value: false },
    // Configurable: withFields wraps it again.
    clone: { value: () => withStatus(clone(), status), configurable: true },
  });
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
