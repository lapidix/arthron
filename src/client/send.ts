import { isCancellation, networkError, responseError } from "../error/error";
import { redactUrl } from "../request/url";
import type { RequestContext } from "../types/context.types";
import type { Resolved } from "./client.types";

/**
 * The global fetch rejects a malformed URL or method with a TypeError that
 * looks just like a network failure (status 0, retried). A bodiless `Request`
 * runs the same checks first, so those become argument errors instead. Only
 * for the global fetch: an injected one owns its URL rules (SvelteKit's
 * server-side `fetch` accepts relative URLs, for one).
 */
function assertSendable(url: string, method: string): void {
  if (typeof Request !== "function") return;
  try {
    new Request(url, { method });
  } catch (cause) {
    const shown = redactUrl(url);
    // fetch's own message repeats the full URL, query included.
    const reason = (cause instanceof Error ? cause.message : String(cause))
      .split(url)
      .join(shown);
    throw new TypeError(
      `arthron: cannot send ${method} ${shown} (${reason}) — use an absolute URL or a baseURL with a scheme (https://…), and a valid HTTP method`,
      { cause },
    );
  }
}

/**
 * Non-ok responses the caller asked for are not failures: an opaque one
 * (`mode: "no-cors"`) and the 3xx of `redirect: "manual"`.
 */
function failedByDefault(res: Response, init: RequestContext["init"]): boolean {
  if (res.type === "opaque" || res.type === "opaqueredirect") return false;
  return !(init.redirect === "manual" && res.status >= 300 && res.status < 400);
}

/** The one place a failure becomes an ArthronError. Cancellation passes through. */
export async function send(
  resolved: Resolved,
  ctx: RequestContext,
  throwOn: ((res: Response) => boolean) | undefined,
): Promise<Response> {
  // Resolved per call, not per client: a global patched after the client was
  // created (msw's `server.listen()`, for one) must still be honoured.
  const fetchImpl = resolved.fetch ?? globalThis.fetch;
  // Here rather than before the pipeline, so it sees the URL the request
  // interceptors produced. A TypeError is not an ArthronError: retry and
  // error interceptors leave it alone.
  if (resolved.fetch === undefined) {
    assertSendable(ctx.url, ctx.init.method ?? "GET");
  }
  const { signal } = ctx.init;
  let res: Response;
  try {
    res = await fetchImpl(ctx.url, ctx.init);
  } catch (thrown) {
    if (isCancellation(thrown, signal)) throw thrown;
    throw networkError(thrown, ctx);
  }
  // Only a non-ok response can become an ArthronError; throwOn narrows which.
  if (res.ok) return res;
  if (!(throwOn ? throwOn(res) : failedByDefault(res, ctx.init))) return res;
  const error = await responseError(res, ctx, resolved.errorMessage);
  // Aborted while the error body was being read (timeout, caller): that is
  // a cancellation, not this status.
  if (signal?.aborted) throw signal.reason;
  throw error;
}
