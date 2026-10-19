import { isFerruleError } from "./error";
import { toHeaderRecord } from "./headers";
import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestContext,
  RequestInterceptor,
  ResponseInterceptor,
} from "./types";

/**
 * Interceptors mutate the context in place. A middleware that calls `next`
 * again (retry) must not see the previous attempt's changes, so every attempt
 * starts from a fresh copy.
 */
function cloneContext({ url, init }: RequestContext): RequestContext {
  return { url, init: { ...init, headers: toHeaderRecord(init.headers) } };
}

/**
 * Owns the order of one request.
 *
 * Middleware wraps the whole call, outermost first in registration order.
 * Each attempt below it runs request interceptors → `send` → response
 * interceptors. Only an `FerruleError` reaches the error interceptors; whatever
 * they return is thrown. Anything else that is thrown — cancellation, a bug
 * in a plugin — propagates untouched.
 */
export async function runPipeline(
  plugins: readonly Plugin[],
  ctx: RequestContext,
  send: (ctx: RequestContext) => Promise<Response>,
): Promise<Response> {
  const middlewares: Middleware[] = [];
  const request: RequestInterceptor[] = [];
  const response: ResponseInterceptor[] = [];
  const error: ErrorInterceptor[] = [];
  for (const plugin of plugins) {
    if (plugin.middleware) middlewares.push(plugin.middleware);
    if (plugin.request) request.push(plugin.request);
    if (plugin.response) response.push(plugin.response);
    if (plugin.error) error.push(plugin.error);
  }

  const attempt = async (input: RequestContext): Promise<Response> => {
    let current = cloneContext(input);
    try {
      for (const interceptor of request) current = await interceptor(current);
      let res = await send(current);
      for (const interceptor of response) res = await interceptor(res, current);
      return res;
    } catch (thrown) {
      if (!isFerruleError(thrown)) throw thrown;
      let err = thrown;
      for (const interceptor of error) err = await interceptor(err, current);
      throw err;
    }
  };

  const dispatch = (
    index: number,
    input: RequestContext,
  ): Promise<Response> => {
    const middleware = middlewares[index];
    if (!middleware) return attempt(input);
    return middleware(input, (next) => dispatch(index + 1, next));
  };
  return dispatch(0, ctx);
}
