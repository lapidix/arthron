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

/** A status text `new Response` takes: tab, space, visible ASCII, Latin-1. */
const REASON_PHRASE = /^[\t\x20-\x7e\x80-\xff]*$/;

/**
 * `new Response(body, init)` for anything fetch hands over. The constructor
 * takes a status of 200–599 and a Latin-1 status text, but fetch passes on
 * what a server sends (LinkedIn answers bots with 999, and Node's fetch reads
 * a reason phrase as UTF-8). One it refuses is built as 599 or "" and set
 * back as an own property; built as 599, an unusual status is never `ok`.
 */
export function createResponse(
  body: BodyInit | null,
  init: ResponseInit & { status: number },
): Response {
  const { status, statusText = "" } = init;
  const statusFits = status >= 200 && status <= 599;
  const textFits = REASON_PHRASE.test(statusText);
  if (statusFits && textFits) return new Response(body, init);
  const built = new Response(body, {
    ...init,
    status: statusFits ? status : 599,
    statusText: textFits ? statusText : "",
  });
  return withStatus(built, status, statusText);
}

function withStatus(
  target: Response,
  status: number,
  statusText: string,
): Response {
  const clone = target.clone.bind(target);
  return Object.defineProperties(target, {
    status: { value: status },
    statusText: { value: statusText },
    // Configurable: withFields wraps it again.
    clone: {
      value: () => withStatus(clone(), status, statusText),
      configurable: true,
    },
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
