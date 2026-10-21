import { runPipeline } from "../pipeline/pipeline";
import { isReadableStream, serializeBody } from "../request/body";
import { mergeHeaders } from "../request/headers";
import { fillPath, leavesBase, resolveUrl } from "../request/url";
import { toArthronPromise } from "../response/arthron-promise";
import type { RequestContext } from "../types/request.types";
import type { ArthronPromise } from "../types/response.types";
import type {
  Arthron,
  ArthronConfig,
  RequestInitWithBody,
  RequestOptions,
} from "./client.types";
import { addPlugins, fetchDefaults, resolveConfig } from "./resolve-config";
import { send } from "./send";

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

/**
 * Build a client from config. The result is immutable — `use` and `extend`
 * return new clients and never touch the one they were called on.
 */
export function arthron(config: ArthronConfig = {}): Arthron {
  const resolved = resolveConfig(config);
  const initDefaults = fetchDefaults(resolved);

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
      // Config fetch defaults sit underneath, so a per-call value wins.
      const requestInit: RequestContext["init"] = {
        ...initDefaults,
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
          {
            url,
            init: requestInit,
            meta: { ...meta },
            // Read per call: a global patched after the client was created
            // (msw's `server.listen()`, for one) is still honoured.
            adapter: resolved.fetch ?? globalThis.fetch,
          },
          (ctx) => send(resolved, ctx, throwOn),
        ),
        init.signal,
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
