import { isArthronError } from "../error/arthron-error";
import { toHeaderRecord } from "../request/headers";
import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "../types/plugin.types";
import type { RequestContext } from "../types/request.types";

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
function cloneContext({
  url,
  init,
  meta,
  adapter,
}: RequestContext): RequestContext {
  const copy: RequestContext["init"] = {
    ...init,
    headers: toHeaderRecord(init.headers),
  };
  if (init.body) copy.body = cloneBody(init.body);
  const out: RequestContext = { url, init: copy, meta: { ...meta } };
  if (adapter) out.adapter = adapter;
  return out;
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
  const out: RequestContext = {
    ...ctx,
    init: { ...ctx.init, headers: toHeaderRecord(ctx.init.headers) },
    // A plugin that builds a fresh `{ url, init }` must not lose the call's
    // meta, nor the adapter it is sent with.
    meta: ctx.meta ?? previous.meta,
  };
  const adapter = ctx.adapter ?? previous.adapter;
  if (adapter) out.adapter = adapter;
  return out;
}

/**
 * A plugin written in JS (or with a cast) that forgets to return would hand
 * `undefined` on — and an error interceptor's would be what the caller
 * catches. Name the plugin slot instead.
 */
function returned<T>(
  value: T | null | undefined,
  who: string,
  what: string,
  cause?: unknown,
  verb = "returned",
): T {
  if (value != null) return value;
  throw new TypeError(
    `arthron: ${who} ${verb} ${value} — return ${what}`,
    cause === undefined ? undefined : { cause },
  );
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
    for (const interceptor of request) {
      const next = returned(
        await interceptor(current),
        "a request interceptor",
        "the context (ctx or a changed copy)",
      );
      current = normalize(next, current);
    }
    let res: Response;
    try {
      res = await send(current);
    } catch (thrown) {
      // Only send's failures are this request's: an ArthronError a plugin
      // throws (its own call failed) is a plugin exception like any other.
      if (!isArthronError(thrown)) throw thrown;
      let err = thrown;
      for (const interceptor of error) {
        err = returned(
          await interceptor(err, current),
          "an error interceptor",
          "the error (err or a changed one)",
          thrown,
        );
      }
      throw err;
    }
    for (const interceptor of response) {
      res = returned(
        await interceptor(res, current),
        "a response interceptor",
        "the Response (res or a new one)",
      );
    }
    return res;
  };

  const dispatch = async (
    index: number,
    input: RequestContext,
  ): Promise<Response> => {
    const middleware = middlewares[index];
    if (!middleware) return attempt(input);
    // A middleware that builds a fresh `{ url, init }` keeps the call's meta
    // and adapter.
    const res = await middleware(input, (next) => {
      const ctx: RequestContext = { ...next, meta: next.meta ?? input.meta };
      const adapter = next.adapter ?? input.adapter;
      if (adapter) ctx.adapter = adapter;
      return dispatch(index + 1, ctx);
    });
    return returned(
      res,
      "a middleware",
      "the Response, usually `return next(ctx)`",
      undefined,
      "resolved with",
    );
  };
  return dispatch(0, ctx);
}
