import { isArthronError } from "../error/arthron-error";
import { toHeaderRecord } from "../request/headers";
import type { RequestContext } from "../types/context.types";
import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "../types/plugin.types";

/** The mutable body kinds an interceptor can `append` to; anything else is shared as is. */
function cloneBody(body: BodyInit): BodyInit {
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const copy = new FormData();
    for (const [name, value] of body) copy.append(name, value);
    return copy;
  }
  if (body instanceof URLSearchParams) return new URLSearchParams(body);
  return body;
}

/**
 * Interceptors mutate the context in place. A middleware that calls `next`
 * again (retry) must not see the previous attempt's changes, so every attempt
 * starts from a fresh copy of the headers and of a FormData/URLSearchParams body.
 */
function cloneContext({ url, init, meta }: RequestContext): RequestContext {
  const copy: RequestContext["init"] = {
    ...init,
    headers: toHeaderRecord(init.headers),
  };
  if (init.body) copy.body = cloneBody(init.body);
  return { url, init: copy, meta: { ...meta } };
}

/**
 * Put headers back into a plain lowercase record. A plugin written in JS (or
 * with a cast) may hand back a `Headers` object, and the next plugin's
 * `{ ...ctx.init.headers }` would otherwise drop every header.
 */
function normalize(
  ctx: RequestContext,
  previous: RequestContext,
): RequestContext {
  return {
    ...ctx,
    init: { ...ctx.init, headers: toHeaderRecord(ctx.init.headers) },
    // A plugin that builds a fresh `{ url, init }` must not lose the call's meta.
    meta: ctx.meta ?? previous.meta,
  };
}

/**
 * Owns the order of one request.
 *
 * Middleware wraps the whole call, outermost first in registration order.
 * Each attempt below it runs request interceptors → `send` → response
 * interceptors. Only an `ArthronError` reaches the error interceptors; whatever
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
      for (const interceptor of request) {
        current = normalize(await interceptor(current), current);
      }
      let res = await send(current);
      for (const interceptor of response) res = await interceptor(res, current);
      return res;
    } catch (thrown) {
      if (!isArthronError(thrown)) throw thrown;
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
    // A middleware that builds a fresh `{ url, init }` keeps the call's meta.
    return middleware(input, (next) =>
      dispatch(index + 1, { ...next, meta: next.meta ?? input.meta }),
    );
  };
  return dispatch(0, ctx);
}
