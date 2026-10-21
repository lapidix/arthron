import {
  cancellationError,
  isCancellation,
  networkError,
  redactErrorUrl,
  responseError,
} from "../error/create-error";
import { isReadableStream, runtimeStreamsRequestBody } from "../request/body";
import { redactUrl, redactUrlIn } from "../request/url";
import type { RequestContext } from "../types/request.types";
import type { ResolvedClientOptions } from "./client.types";

/**
 * The global fetch rejects a malformed URL or method with a TypeError that
 * looks just like a network failure (status 0, retried). Once fetch has
 * failed, a bodiless `Request` runs the same checks, so those become argument
 * errors instead — at no cost to a call that goes through. Only for the
 * global fetch: an injected one owns its URL rules (SvelteKit's server-side
 * `fetch` accepts relative URLs, for one).
 */
function assertSendable(url: string, method: string): void {
  if (typeof Request !== "function") return;
  try {
    new Request(url, { method });
  } catch (cause) {
    // fetch's own message repeats the full URL, query included.
    redactErrorUrl(cause, url);
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
  resolved: ResolvedClientOptions,
  ctx: RequestContext,
  throwOn: ((res: Response) => boolean) | undefined,
): Promise<Response> {
  // The attempt's fetchFn, which a plugin may have replaced or wrapped.
  // ResolvedClientOptions per call, not per client: a global patched after the client was
  // created (msw's `server.listen()`, for one) must still be honoured.
  const fetchFn = ctx.fetchFn ?? resolved.fetchFn ?? globalThis.fetch;
  // Checked before the try: calling it would throw a TypeError there, and a
  // plugin's bug would pass for a network failure — retried, status 0.
  if (typeof fetchFn !== "function") {
    throw new TypeError(
      `arthron: requestContext.fetchFn must be a function with fetch's signature, got ${fetchFn === null ? "null" : `a ${typeof fetchFn}`} — a plugin set it; return { ...requestContext, fetchFn: fn }`,
    );
  }
  // Here rather than before the pipeline, so they see the URL the request
  // interceptors produced. Whenever the client relies on the runtime's fetch
  // — also when a plugin wrapped or swapped it for this attempt (upload
  // progress) — but not for an injected fetch, which owns its URL rules. A
  // TypeError is not an ArthronError: retry and error interceptors leave it
  // alone.
  const runtimeFetch = resolved.fetchFn === undefined;
  const method = ctx.init.method ?? "GET";
  if (runtimeFetch) assertStreamable(ctx.url, method, ctx.init.body);
  const { signal } = ctx.init;
  let res: Response;
  try {
    res = await fetchFn(ctx.url, ctx.init);
  } catch (thrown) {
    if (isCancellation(thrown, signal)) throw cancellationError(thrown, signal);
    if (runtimeFetch) assertSendable(ctx.url, method);
    throw networkError(thrown, ctx);
  }
  // Only a non-ok response can become an ArthronError; throwOn narrows which.
  if (res.ok) return res;
  if (!(throwOn ? throwOn(res) : failedByDefault(res, ctx.init))) return res;
  const error = await responseError(res, ctx, resolved.extractDescription);
  // Aborted while the error body was being read (timeout, caller): that is
  // a cancellation, not this status.
  if (signal?.aborted) throw signal.reason;
  throw error;
}
