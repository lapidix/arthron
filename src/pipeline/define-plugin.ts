import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "../types/plugin.types";

/*
 * Identity helpers. They do nothing at runtime; they exist so a plugin written
 * in its own file gets contextual typing without an explicit annotation.
 */

/** Identity helper: gives a middleware written in its own file the right parameter types. */
export const defineMiddleware = (middleware: Middleware): Middleware =>
  middleware;

/** Identity helpers for each interceptor kind — `defineInterceptor.request(fn)` etc. */
export const defineInterceptor = {
  request: (interceptor: RequestInterceptor): RequestInterceptor => interceptor,
  response: (interceptor: ResponseInterceptor): ResponseInterceptor =>
    interceptor,
  error: (interceptor: ErrorInterceptor): ErrorInterceptor => interceptor,
};

/** Identity helper: type-checks a plugin object literal without an annotation. */
export const definePlugin = (plugin: Plugin): Plugin => plugin;
