import {
  cancellationError,
  isCancellation,
  networkError,
  responseError,
} from "../error/create-error";
import { isReadableStream, runtimeStreamsRequestBody } from "../request/body";
import { redactUrl, redactUrlIn } from "../request/url";
import type { RequestContext } from "../types/request.types";
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
    // fetch's own message repeats the full URL, query included.
    const reason = redactUrlIn(
      cause instanceof Error ? cause.message : String(cause),
      url,
    );
    throw new TypeError(
      `arthron: cannot send ${method} ${redactUrl(url)} (${reason}) — use an absolute URL or a baseURL with a scheme (https://…), and a valid HTTP method`,
      { cause },
    );
  }
}

/**
 * A ReadableStream body the browser cannot stream is rejected before it is
 * sent: Firefox would send the text "[object ReadableStream]", older Safari
 * fails with a bare network error. Only for the global fetch, like
 * assertSendable.
 */
function assertStreamable(url: string, method: string, body: unknown): void {
  if (!isReadableStream(body) || runtimeStreamsRequestBody()) return;
  throw new TypeError(
    `arthron: cannot send ${method} ${redactUrl(url)} with a ReadableStream body — this browser cannot stream a request body and would send it garbled or not at all; pass a Blob or ArrayBuffer instead`,
  );
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
  // The attempt's own fetch, which a plugin may have replaced or wrapped.
  // Resolved per call, not per client: a global patched after the client was
  // created (msw's `server.listen()`, for one) must still be honoured.
  const fetchImpl = ctx.fetch ?? resolved.fetch ?? globalThis.fetch;
  // Here rather than before the pipeline, so it sees the URL the request
  // interceptors produced. Only for the global fetch itself: an injected or
  // wrapped one owns its rules. A TypeError is not an ArthronError: retry
  // and error interceptors leave it alone.
  if (fetchImpl === globalThis.fetch) {
    const method = ctx.init.method ?? "GET";
    assertSendable(ctx.url, method);
    assertStreamable(ctx.url, method, ctx.init.body);
  }
  const { signal } = ctx.init;
  let res: Response;
  try {
    res = await fetchImpl(ctx.url, ctx.init);
  } catch (thrown) {
    if (isCancellation(thrown, signal)) throw cancellationError(thrown, signal);
    throw networkError(thrown, ctx);
  }
  // Only a non-ok response can become an ArthronError; throwOn narrows which.
  if (res.ok) return res;
  if (!(throwOn ? throwOn(res) : failedByDefault(res, ctx.init))) return res;
  const error = await responseError(res, ctx, resolved.errorDetail);
  // Aborted while the error body was being read (timeout, caller): that is
  // a cancellation, not this status.
  if (signal?.aborted) throw signal.reason;
  throw error;
}
