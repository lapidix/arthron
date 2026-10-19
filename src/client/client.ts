import { isCancellation, networkError, responseError } from "../error/error";
import { runPipeline } from "../pipeline/pipeline";
import { isReadableStream, serializeBody } from "../request/body";
import { mergeHeaders, toHeaderRecord } from "../request/headers";
import { fillPath, leavesBase, redactUrl, resolveUrl } from "../request/url";
import { toArthronPromise } from "../response/promise";
import type {
  Arthron,
  ArthronConfig,
  ArthronPromise,
  Plugin,
  RequestContext,
  RequestInitWithBody,
  RequestOptions,
} from "../types";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
/** Sent uppercased whatever their case; fetch itself only normalizes six. */
const STANDARD_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "QUERY",
]);

type Resolved = Omit<ArthronConfig, "headers" | "use"> & {
  headers: Record<string, string>;
  use: readonly Plugin[];
};

/**
 * Add plugins to a list. A named plugin takes the place of the one already
 * there with that name — same position, so a replaced `logging()` stays
 * outermost and a second `retry()` does not multiply attempts. Unnamed
 * plugins append.
 */
function addPlugins(
  base: readonly Plugin[],
  added: readonly Plugin[],
): Plugin[] {
  const out = [...base];
  for (const plugin of added) {
    const at =
      plugin.name === undefined
        ? -1
        : out.findIndex((p) => p.name === plugin.name);
    if (at === -1) out.push(plugin);
    else out[at] = plugin;
  }
  return out;
}

/** Normalize once so `extend` can merge headers and add plugins cheaply. */
function resolveConfig(config: ArthronConfig): Resolved {
  const { headers, use, ...rest } = config;
  return {
    ...rest,
    headers: toHeaderRecord(headers),
    use: addPlugins([], use ?? []),
  };
}

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
    const shown = redactUrl(url);
    // fetch's own message repeats the full URL, query included.
    const reason = (cause instanceof Error ? cause.message : String(cause))
      .split(url)
      .join(shown);
    throw new TypeError(
      `arthron: cannot send ${method} ${shown} (${reason}) — use an absolute URL or a baseURL with a scheme (https://…), and a valid HTTP method`,
      { cause },
    );
  }
}

/**
 * Non-ok responses the caller asked for are not failures: an opaque one
 * (`mode: "no-cors"`) and the 3xx of `redirect: "manual"`.
 */
function failedByDefault(res: Response, init: RequestContext["init"]): boolean {
  if (res.type === "opaque" || res.type === "opaqueredirect") return false;
  return !(init.redirect === "manual" && res.status >= 300 && res.status < 400);
}

/**
 * Build a client from config. The result is immutable — `use` and `extend`
 * return new clients and never touch the one they were called on.
 */
export function arthron(config: ArthronConfig = {}): Arthron {
  const resolved = resolveConfig(config);

  /** The one place a failure becomes an ArthronError. Cancellation passes through. */
  const send = async (
    ctx: RequestContext,
    throwOn: ((res: Response) => boolean) | undefined,
  ): Promise<Response> => {
    // Resolved per call, not per client: a global patched after the client was
    // created (msw's `server.listen()`, for one) must still be honoured.
    const fetchImpl = resolved.fetch ?? globalThis.fetch;
    // Here rather than before the pipeline, so it sees the URL the request
    // interceptors produced. A TypeError is not an ArthronError: retry and
    // error interceptors leave it alone.
    if (resolved.fetch === undefined) {
      assertSendable(ctx.url, ctx.init.method ?? "GET");
    }
    const { signal } = ctx.init;
    let res: Response;
    try {
      res = await fetchImpl(ctx.url, ctx.init);
    } catch (thrown) {
      if (isCancellation(thrown, signal)) throw thrown;
      throw networkError(thrown, ctx);
    }
    // Only a non-ok response can become an ArthronError; throwOn narrows which.
    if (res.ok) return res;
    if (!(throwOn ? throwOn(res) : failedByDefault(res, ctx.init))) return res;
    const error = await responseError(res, ctx, resolved.errorMessage);
    // Aborted while the error body was being read (timeout, caller): that is
    // a cancellation, not this status.
    if (signal?.aborted) throw signal.reason;
    throw error;
  };

  const dispatch = (
    path: string,
    method: string,
    rawBody: unknown,
    {
      params,
      headers: callHeaders,
      meta,
      throwOn = resolved.throwOn,
      path: pathValues,
      ...init
    }: RequestOptions,
  ): ArthronPromise => {
    try {
      const upper = method.toUpperCase();
      const verb = STANDARD_METHODS.has(upper) ? upper : method;
      if (rawBody !== undefined && BODYLESS_METHODS.has(upper)) {
        // fetch rejects these with a TypeError that would otherwise be mistaken for a network failure and retried.
        throw new TypeError(
          `arthron: ${upper} requests cannot carry a body — send it as params (query) or switch to POST`,
        );
      }
      if (pathValues) path = fillPath(path, pathValues);
      const url = resolveUrl(
        resolved.baseURL,
        path,
        params,
        resolved.allowAbsoluteUrls,
      );
      // Config headers (credentials, typically) belong to baseURL's origin.
      // Another origin, reachable only with allowAbsoluteUrls, gets per-call
      // headers alone.
      const defaults = leavesBase(resolved.baseURL, path)
        ? undefined
        : resolved.headers;
      const { body, headers } = serializeBody(
        rawBody,
        mergeHeaders(defaults, callHeaders),
      );
      // Config credentials sit underneath so a per-call value wins, like every other option.
      const requestInit: RequestContext["init"] = {
        ...(resolved.credentials !== undefined && {
          credentials: resolved.credentials,
        }),
        ...init,
        method: verb,
        headers,
      };
      if (body !== undefined) requestInit.body = body;
      // Without half-duplex, fetch rejects a streaming upload (Node, Chromium).
      if (isReadableStream(body))
        Object.assign(requestInit, { duplex: "half" });
      return toArthronPromise(
        runPipeline(
          resolved.use,
          { url, init: requestInit, meta: { ...meta } },
          (ctx) => send(ctx, throwOn),
        ),
      );
    } catch (thrown) {
      // Argument errors (no baseURL, unserializable body) reject like everything else.
      return toArthronPromise(Promise.reject(thrown));
    }
  };

  const derive = (next: Partial<ArthronConfig>): Arthron => {
    const merged: ArthronConfig = {
      ...resolved,
      ...next,
      headers: mergeHeaders(resolved.headers, next.headers),
      use: addPlugins(resolved.use, next.use ?? []),
    };
    return arthron(merged);
  };

  return {
    get: (path, init = {}) => dispatch(path, "GET", undefined, init),
    delete: (path, init = {}) => dispatch(path, "DELETE", undefined, init),
    head: (path, init = {}) => dispatch(path, "HEAD", undefined, init),
    post: (path, body, init = {}) => dispatch(path, "POST", body, init),
    put: (path, body, init = {}) => dispatch(path, "PUT", body, init),
    patch: (path, body, init = {}) => dispatch(path, "PATCH", body, init),
    query: (path, body, init = {}) => dispatch(path, "QUERY", body, init),
    request: (path, init: RequestInitWithBody) => {
      const { method, body, ...rest } = init;
      if (!method) {
        return toArthronPromise(
          Promise.reject(
            new TypeError(
              'arthron: request() needs init.method — e.g. request(path, { method: "OPTIONS" }); use get/post/... for the common verbs',
            ),
          ),
        );
      }
      return dispatch(path, method, body, rest);
    },
    use: (...plugins) => derive({ use: plugins }),
    extend: (next) => derive(next),
    without: (...names) =>
      arthron({
        ...resolved,
        use: resolved.use.filter(
          (p) => p.name === undefined || !names.includes(p.name),
        ),
      }),
  };
}
