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
   * Identity within a client, required: `use`/`extend` replace the plugin of
   * the same pluginName in place, `without(pluginName)` removes it. The
   * built-ins are "bearerAuth", "logging", "retry", "timeout" and
   * "uploadProgress". Not `name`: a function has one, so a bare middleware
   * would pass for a plugin.
   */
  pluginName: string;
  /** Wraps the whole call and controls its flow: may call `next` again, or not at all. */
  middleware?: Middleware;
  /** Transforms each attempt's context before it is sent; returns the context to send. */
  requestInterceptor?: RequestInterceptor;
  /** Transforms each successful attempt's Response; returns the Response to pass on. */
  responseInterceptor?: ResponseInterceptor;
  /** Transforms each failed attempt's ArthronError; returns the error to throw. */
  errorInterceptor?: ErrorInterceptor;
}
