import { isReadableStream, serializeBody } from "./body";
import { isCancellation, networkError, responseError } from "./error";
import { mergeHeaders, toHeaderRecord } from "./headers";
import { runPipeline } from "./pipeline";
import { toArthronPromise } from "./promise";
import type {
  Arthron,
  ArthronConfig,
  ArthronPromise,
  Plugin,
  RequestContext,
  RequestInitWithBody,
  RequestOptions,
} from "./types";
import { resolveUrl } from "./url";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

type Resolved = Omit<ArthronConfig, "headers" | "use"> & {
  headers: Record<string, string>;
  use: readonly Plugin[];
};

/** Normalize once so `extend` can merge headers and append plugins cheaply. */
function resolveConfig(config: ArthronConfig): Resolved {
  const { headers, use, ...rest } = config;
  return { ...rest, headers: toHeaderRecord(headers), use: use ?? [] };
}

/**
 * fetch rejects a malformed URL or method with a TypeError that looks just
 * like a network failure (status 0, retried). A bodiless `Request` runs the
 * same checks up front, so those become argument errors instead.
 */
function assertSendable(url: string, method: string): void {
  if (typeof Request !== "function") return;
  try {
    new Request(url, { method });
  } catch (cause) {
    throw new TypeError(
      `arthron: cannot send ${method} ${url} — use an absolute URL or a baseURL with a scheme (https://…), and a valid HTTP method`,
      { cause },
    );
  }
}

/**
 * Build a client from config. The result is immutable — `use` and `extend`
 * return new clients and never touch the one they were called on.
 */
export function arthron(config: ArthronConfig = {}): Arthron {
  const resolved = resolveConfig(config);

  /** The one place a failure becomes an ArthronError. Cancellation passes through. */
  const send = async (ctx: RequestContext): Promise<Response> => {
    // Resolved per call, not per client: a global patched after the client was
    // created (msw's `server.listen()`, for one) must still be honoured.
    const fetchImpl = resolved.fetch ?? globalThis.fetch;
    const { signal } = ctx.init;
    let res: Response;
    try {
      res = await fetchImpl(ctx.url, ctx.init);
    } catch (thrown) {
      if (isCancellation(thrown, signal)) throw thrown;
      throw networkError(thrown, ctx);
    }
    if (res.ok) return res;
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
    { params, headers: callHeaders, ...init }: RequestOptions,
  ): ArthronPromise => {
    try {
      if (rawBody !== undefined && BODYLESS_METHODS.has(method.toUpperCase())) {
        // fetch rejects these with a TypeError that would otherwise be mistaken for a network failure and retried.
        throw new TypeError(
          `arthron: ${method.toUpperCase()} requests cannot carry a body — send it as params (query) or switch to POST`,
        );
      }
      const url = resolveUrl(resolved.baseURL, path, params);
      assertSendable(url, method);
      const { body, headers } = serializeBody(
        rawBody,
        mergeHeaders(resolved.headers, callHeaders),
      );
      // Config credentials sit underneath so a per-call value wins, like every other option.
      const requestInit: RequestInit = {
        ...(resolved.credentials !== undefined && {
          credentials: resolved.credentials,
        }),
        ...init,
        method,
        headers,
      };
      if (body !== undefined) requestInit.body = body;
      // Without half-duplex, fetch rejects a streaming upload (Node, Chromium).
      if (isReadableStream(body))
        Object.assign(requestInit, { duplex: "half" });
      return toArthronPromise(
        runPipeline(resolved.use, { url, init: requestInit }, send),
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
      use: [...resolved.use, ...(next.use ?? [])],
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
  };
}
