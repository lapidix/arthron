import { serializeBody } from "./body";
import { isCancellation, networkError, responseError } from "./error";
import { mergeHeaders, toHeaderRecord } from "./headers";
import { runPipeline } from "./pipeline";
import { toFerrulePromise } from "./promise";
import type {
  Ferrule,
  FerruleConfig,
  FerrulePromise,
  Plugin,
  RequestContext,
  RequestInitWithBody,
  RequestOptions,
} from "./types";
import { resolveUrl } from "./url";

type Resolved = Omit<FerruleConfig, "headers" | "use"> & {
  headers: Record<string, string>;
  use: readonly Plugin[];
};

/** Normalize once so `extend` can merge headers and append plugins cheaply. */
function resolveConfig(config: FerruleConfig): Resolved {
  const { headers, use, ...rest } = config;
  return { ...rest, headers: toHeaderRecord(headers), use: use ?? [] };
}

/**
 * Build a client from config. The result is immutable — `use` and `extend`
 * return new clients and never touch the one they were called on.
 */
export function ferrule(config: FerruleConfig = {}): Ferrule {
  const resolved = resolveConfig(config);
  const fetchImpl = resolved.fetch ?? globalThis.fetch;

  /** The one place a failure becomes an FerruleError. Cancellation passes through. */
  const send = async (ctx: RequestContext): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(ctx.url, ctx.init);
    } catch (thrown) {
      if (isCancellation(thrown)) throw thrown;
      throw networkError(thrown, ctx);
    }
    if (!res.ok) throw await responseError(res, ctx, resolved.errorMessage);
    return res;
  };

  const dispatch = (
    path: string,
    method: string,
    rawBody: unknown,
    { params, headers: callHeaders, ...init }: RequestOptions,
  ): FerrulePromise => {
    try {
      const url = resolveUrl(resolved.baseURL, path, params);
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
      return toFerrulePromise(
        runPipeline(resolved.use, { url, init: requestInit }, send),
      );
    } catch (thrown) {
      // Argument errors (no baseURL, unserializable body) reject like everything else.
      return toFerrulePromise(Promise.reject(thrown));
    }
  };

  const derive = (next: Partial<FerruleConfig>): Ferrule => {
    const merged: FerruleConfig = {
      ...resolved,
      ...next,
      headers: mergeHeaders(resolved.headers, next.headers),
      use: [...resolved.use, ...(next.use ?? [])],
    };
    return ferrule(merged);
  };

  return {
    get: (path, init = {}) => dispatch(path, "GET", undefined, init),
    delete: (path, init = {}) => dispatch(path, "DELETE", undefined, init),
    head: (path, init = {}) => dispatch(path, "HEAD", undefined, init),
    post: (path, body, init = {}) => dispatch(path, "POST", body, init),
    put: (path, body, init = {}) => dispatch(path, "PUT", body, init),
    patch: (path, body, init = {}) => dispatch(path, "PATCH", body, init),
    request: (path, init: RequestInitWithBody) => {
      const { method, body, ...rest } = init;
      if (!method) {
        return toFerrulePromise(
          Promise.reject(
            new TypeError("ferrule: request() requires init.method"),
          ),
        );
      }
      return dispatch(path, method, body, rest);
    },
    use: (...plugins) => derive({ use: plugins }),
    extend: (next) => derive(next),
  };
}
