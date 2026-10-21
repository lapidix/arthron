import { createPipeline } from "../pipeline/pipeline";
import { isReadableStream, serializeBody } from "../request/body";
import { mergeHeaders } from "../request/headers";
import { fillPath, leavesBase, originSet, resolveUrl } from "../request/url";
import { toResponsePromise } from "../response/response-promise";
import type { RequestContext } from "../types/request.types";
import type { ResponsePromise } from "../types/response.types";
import type {
  ArthronClient,
  ArthronClientOptions,
  RequestOptions,
  RequestOptionsWithMethod,
} from "./client.types";
import {
  addPlugins,
  fetchDefaults,
  resolveClientOptions,
} from "./resolve-options";
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
 * 1.x per-call option names and what replaced them. Left in init they would
 * reach fetch and be ignored: {id} sent unfilled, the query left off.
 */
const REPLACED_PER_CALL = {
  path: "pathParams",
  params: "queryParams",
} as const;

/**
 * Build a client from its options. The result is immutable — `use` and `extend`
 * return new clients and never touch the one they were called on.
 */
export function arthron(
  clientOptions: ArthronClientOptions = {},
): ArthronClient {
  const resolved = resolveClientOptions(clientOptions);
  const initDefaults = fetchDefaults(resolved);
  // Checked here, so a bad entry fails when the client is created.
  const allowed = resolved.allowedOrigins && originSet(resolved.allowedOrigins);
  const pipeline = createPipeline(resolved.plugins);

  const call = (
    path: string,
    method: string,
    rawBody: unknown,
    {
      queryParams,
      headers: callHeaders,
      meta,
      throwOn = resolved.throwOn,
      pathParams,
      ...init
    }: RequestOptions,
  ): ResponsePromise => {
    try {
      for (const [old, now] of Object.entries(REPLACED_PER_CALL)) {
        if ((init as Record<string, unknown>)[old] !== undefined) {
          throw new TypeError(
            `arthron: the ${old} option was replaced by ${now} in 2.0 — pass { ${now}: { … } }`,
          );
        }
      }
      const upper = method.toUpperCase();
      const verb = STANDARD_METHODS.has(upper) ? upper : method;
      if (rawBody !== undefined && BODYLESS_METHODS.has(upper)) {
        // fetch rejects these with a TypeError that would otherwise be mistaken for a network failure and retried.
        throw new TypeError(
          `arthron: ${upper} requests cannot carry a body — send it as queryParams or switch to POST`,
        );
      }
      if (pathParams) path = fillPath(path, pathParams);
      const url = resolveUrl(resolved.baseURL, path, queryParams, allowed);
      // Config headers (credentials, typically) belong to baseURL's origin.
      // Another origin, reachable only through allowedOrigins, gets per-call
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
      return toResponsePromise(
        pipeline(
          {
            url,
            init: requestInit,
            meta: { ...meta },
            // Read per call: a global patched after the client was created
            // (msw's `server.listen()`, for one) is still honoured.
            fetchFn: resolved.fetchFn ?? globalThis.fetch,
          },
          (ctx) => send(resolved, ctx, throwOn),
        ),
        init.signal,
      );
    } catch (thrown) {
      // Argument errors (no baseURL, unserializable body) reject like everything else.
      return toResponsePromise(Promise.reject(thrown));
    }
  };

  const derive = (changes: Partial<ArthronClientOptions>): ArthronClient => {
    const merged: ArthronClientOptions = {
      ...resolved,
      ...changes,
      headers: mergeHeaders(resolved.headers, changes.headers),
      plugins: addPlugins(resolved.plugins, changes.plugins ?? []),
    };
    return arthron(merged);
  };

  return {
    get: (path, requestOptions = {}) =>
      call(path, "GET", undefined, requestOptions),
    delete: (path, requestOptions = {}) =>
      call(path, "DELETE", undefined, requestOptions),
    head: (path, requestOptions = {}) =>
      call(path, "HEAD", undefined, requestOptions),
    post: (path, body, requestOptions = {}) =>
      call(path, "POST", body, requestOptions),
    put: (path, body, requestOptions = {}) =>
      call(path, "PUT", body, requestOptions),
    patch: (path, body, requestOptions = {}) =>
      call(path, "PATCH", body, requestOptions),
    query: (path, body, requestOptions = {}) =>
      call(path, "QUERY", body, requestOptions),
    request: (path, requestOptions: RequestOptionsWithMethod) => {
      const { method, body, ...rest } = requestOptions;
      if (!method) {
        return toResponsePromise(
          Promise.reject(
            new TypeError(
              'arthron: request() needs a method — e.g. request(path, { method: "OPTIONS" }); use get/post/... for the common verbs',
            ),
          ),
        );
      }
      return call(path, method, body, rest);
    },
    use: (...plugins) => derive({ plugins }),
    extend: (changes) => derive(changes),
    without: (...pluginNames) =>
      arthron({
        ...resolved,
        plugins: resolved.plugins.filter(
          (p) => !pluginNames.includes(p.pluginName),
        ),
      }),
  };
}
