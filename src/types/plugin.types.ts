// The one import from outside types/: ArthronError is a class, so it cannot live here.
import type { ArthronError } from "../error/arthron-error";
import type { RequestContext } from "./request.types";

/** Runs before each attempt. Returns the context to send (may be a new object). */
export type RequestInterceptor = (
  ctx: RequestContext,
) => RequestContext | Promise<RequestContext>;

/** Runs after a successful attempt. The body is single-use — `clone()` to peek. */
export type ResponseInterceptor = (
  res: Response,
  ctx: RequestContext,
) => Response | Promise<Response>;

/** Runs after a failed attempt. Returns the error to throw; it is always thrown. */
export type ErrorInterceptor = (
  err: ArthronError,
  ctx: RequestContext,
) => ArthronError | Promise<ArthronError>;

/**
 * Wraps the whole call. `next` runs everything below it (request interceptors →
 * fetch → response/error interceptors) and may be called again to retry.
 * `next` rejects with an `ArthronError`, or with the untouched original when the
 * failure was a cancellation or a bug in a plugin.
 */
export type Middleware = (
  ctx: RequestContext,
  next: (ctx: RequestContext) => Promise<Response>,
) => Promise<Response>;

export interface Plugin {
  /**
   * Identity within a client: `use`/`extend` replace the plugin of the same
   * name in place, `without(name)` removes it. The built-ins are named
   * "bearerAuth", "logging", "retry" and "timeout". Leave it out to always
   * append.
   */
  name?: string;
  middleware?: Middleware;
  request?: RequestInterceptor;
  response?: ResponseInterceptor;
  error?: ErrorInterceptor;
}
