import { isArthronError } from "../error/arthron-error";
import { tagOf } from "../request/body";
import { toHeaderRecord } from "../request/headers";
import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "../types/plugin.types";
import type { RequestContext } from "../types/request.types";

/**
 * The mutable body kinds an interceptor can `append` to; anything else is
 * shared as is. Known by type tag, as serializeBody knows them, and copied
 * into their own class — a polyfill's (formdata-node) or another realm's
 * holds values the global one may not take.
 */
function cloneBody(body: BodyInit): BodyInit {
  const tag = tagOf(body);
  if (tag !== "FormData" && tag !== "URLSearchParams") return body;
  const Own = (body as object).constructor as new (
    init?: string,
  ) => FormData & URLSearchParams;
  try {
    if (tag === "URLSearchParams") return new Own(String(body));
    const copy = new Own();
    for (const [name, value] of body as FormData) copy.append(name, value);
    return copy;
  } catch {
    // A class that cannot be built again: shared, as before.
    return body;
  }
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
  fetchFn,
}: RequestContext): RequestContext {
  const copy: RequestContext["init"] = {
    ...init,
    headers: toHeaderRecord(init.headers),
  };
  if (init.body) copy.body = cloneBody(init.body);
  const out: RequestContext = { url, init: copy, meta: { ...meta } };
  if (fetchFn) out.fetchFn = fetchFn;
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
    // meta, nor the fetchFn it is sent with.
    meta: ctx.meta ?? previous.meta,
  };
  const fetchFn = ctx.fetchFn ?? previous.fetchFn;
  if (fetchFn) out.fetchFn = fetchFn;
  return out;
}

/**
 * The 1.x name of `fetchFn`. TypeScript does not flag it on a spread
 * (`{ ...ctx, fetch }`), and ignored, a test's mock would be passed over for
 * the real network.
 */
function refuseFetchField(ctx: RequestContext, problem: string, fix: string) {
  if ((ctx as { fetch?: unknown }).fetch === undefined) return;
  throw new TypeError(
    `arthron: ${problem}, which is ctx.fetchFn since 2.0 — ${fix} { ...ctx, fetchFn }`,
  );
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

type Send = (ctx: RequestContext) => Promise<Response>;

/**
 * Owns the order of every request a client sends. The plugins are sorted
 * into their slots once, when the client is created — a client's plugins
 * never change.
 *
 * Middleware wraps the whole call, outermost first in registration order.
 * Each attempt below it runs request interceptors → `send` → response
 * interceptors. Only an `ArthronError` reaches the error interceptors; whatever
 * they return is thrown. Anything else that is thrown — cancellation, a bug
 * in a plugin — propagates untouched.
 */
export function createPipeline(
  plugins: readonly Plugin[],
): (ctx: RequestContext, send: Send) => Promise<Response> {
  const middlewares: Middleware[] = [];
  const requestInterceptors: RequestInterceptor[] = [];
  const responseInterceptors: ResponseInterceptor[] = [];
  const errorInterceptors: ErrorInterceptor[] = [];
  for (const plugin of plugins) {
    if (plugin.middleware) middlewares.push(plugin.middleware);
    if (plugin.requestInterceptor)
      requestInterceptors.push(plugin.requestInterceptor);
    if (plugin.responseInterceptor)
      responseInterceptors.push(plugin.responseInterceptor);
    if (plugin.errorInterceptor)
      errorInterceptors.push(plugin.errorInterceptor);
  }

  const attempt = async (
    input: RequestContext,
    send: Send,
  ): Promise<Response> => {
    let current = cloneContext(input);
    for (const interceptor of requestInterceptors) {
      const changed = returned(
        await interceptor(current),
        "a request interceptor",
        "the context (ctx or a changed copy)",
      );
      refuseFetchField(
        changed,
        "a request interceptor set ctx.fetch",
        "return",
      );
      current = normalize(changed, current);
    }
    let res: Response;
    try {
      res = await send(current);
    } catch (thrown) {
      // Only send's failures are this request's: an ArthronError a plugin
      // throws (its own call failed) is a plugin exception like any other.
      if (!isArthronError(thrown)) throw thrown;
      let err = thrown;
      for (const interceptor of errorInterceptors) {
        err = returned(
          await interceptor(err, current),
          "an error interceptor",
          "the error (err or a changed one)",
          thrown,
        );
      }
      throw err;
    }
    for (const interceptor of responseInterceptors) {
      res = returned(
        await interceptor(res, current),
        "a response interceptor",
        "the Response (res or a new one)",
      );
    }
    return res;
  };

  const runFrom = async (
    index: number,
    input: RequestContext,
    send: Send,
  ): Promise<Response> => {
    const middleware = middlewares[index];
    if (!middleware) return attempt(input, send);
    // A middleware that builds a fresh `{ url, init }` keeps the call's meta
    // and fetchFn.
    const res = await middleware(input, (passed) => {
      refuseFetchField(passed, "a middleware passed ctx.fetch to next", "pass");
      const ctx: RequestContext = {
        ...passed,
        meta: passed.meta ?? input.meta,
      };
      const fetchFn = passed.fetchFn ?? input.fetchFn;
      if (fetchFn) ctx.fetchFn = fetchFn;
      return runFrom(index + 1, ctx, send);
    });
    return returned(
      res,
      "a middleware",
      "the Response, usually `return next(ctx)`",
      undefined,
      "resolved with",
    );
  };
  return (ctx, send) => runFrom(0, ctx, send);
}

/** One request through `plugins` — `createPipeline` for a single use, as tests run it. */
export function runPipeline(
  plugins: readonly Plugin[],
  ctx: RequestContext,
  send: Send,
): Promise<Response> {
  return createPipeline(plugins)(ctx, send);
}
