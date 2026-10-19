import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "./types";

/*
 * Identity helpers. They do nothing at runtime; they exist so a plugin written
 * in its own file gets contextual typing without an explicit annotation.
 */

export const defineMiddleware = (middleware: Middleware): Middleware =>
  middleware;

export const defineInterceptor = {
  request: (interceptor: RequestInterceptor): RequestInterceptor => interceptor,
  response: (interceptor: ResponseInterceptor): ResponseInterceptor =>
    interceptor,
  error: (interceptor: ErrorInterceptor): ErrorInterceptor => interceptor,
};

export const definePlugin = (plugin: Plugin): Plugin => plugin;
