import { isArthronError } from "../../error/arthron-error";
import { isReadableStream } from "../../request/body";
import { httpOrigins, originOf } from "../../request/url";
import type { Plugin } from "../../types/plugin.types";
import type { BearerAuthOptions } from "./bearer-auth.types";

/** 1.x option, its replacement, and how to pass it. */
const REPLACED = [
  ["token", "accessTokenFn", "accessTokenFn"],
  ["refresh", "refreshFn", "refreshFn"],
  ["origin", "tokenOrigins", "tokenOrigins: [url]"],
] as const;

const EXAMPLE = 'tokenOrigins: ["https://api.example.com"]';

/** `tokenOrigins` as origins, checked when the plugin is created. */
function tokenOriginSet(urls: BearerAuthOptions["tokenOrigins"]): Set<string> {
  if (!Array.isArray(urls)) {
    const kind = typeof urls === "string" ? "a string" : String(urls);
    throw new TypeError(
      `arthron: bearerAuth({ tokenOrigins }) takes a list of URLs, got ${kind} — e.g. ${EXAMPLE}`,
    );
  }
  return httpOrigins(urls, {
    empty: `arthron: bearerAuth({ tokenOrigins }) needs at least one URL — e.g. ${EXAMPLE}`,
    invalid: (url) =>
      `arthron: bearerAuth({ tokenOrigins }) needs http(s) URLs, got ${url} — e.g. ${EXAMPLE}`,
  });
}

/**
 * Bearer-token auth. A request interceptor sets `authorization: Bearer
 * <token>` on every attempt to `tokenOrigins`; with `refreshFn`, a middleware turns a
 * 401 into one refresh and one more try. Concurrent 401s share the refresh
 * (with refresh-token rotation, parallel refreshes revoke each other), and a
 * call whose token was replaced meanwhile just retries. A call opts out with
 * `meta: { bearerAuth: false }`.
 */
export function bearerAuth(options: BearerAuthOptions): Plugin {
  // The 1.x names: unknown keys would be ignored, and no token ever sent.
  for (const [old, now, fix] of REPLACED) {
    if ((options as Record<string, unknown>)[old] !== undefined) {
      throw new TypeError(
        `arthron: bearerAuth's ${old} option was replaced by ${now} in 2.0 — pass bearerAuth({ ${fix} })`,
      );
    }
  }
  const { accessTokenFn, refreshFn } = options;
  const allowed = tokenOriginSet(options.tokenOrigins);
  // A relative URL (baseURL "/api") is on the page's origin.
  const ours = (url: string) => allowed.has(originOf(url) ?? "");
  const bearer = async () => {
    const value = await accessTokenFn();
    return value ? `Bearer ${value}` : undefined;
  };
  let refreshing: Promise<void> | undefined;
  // True while refreshFn runs up to its first await: a call that starts then
  // is the refresh's own, and on a 401 it would wait for itself.
  let inRefresh = false;
  const startRefresh = (refresh: () => Promise<void>): Promise<void> => {
    inRefresh = true;
    try {
      return refresh().finally(() => {
        refreshing = undefined;
      });
    } finally {
      inRefresh = false;
    }
  };

  return {
    pluginName: "bearerAuth",
    requestInterceptor: async (ctx) => {
      if (ctx.meta?.bearerAuth === false || !ours(ctx.url)) return ctx;
      const value = await bearer();
      if (!value) return ctx;
      return {
        ...ctx,
        init: {
          ...ctx.init,
          headers: { ...ctx.init.headers, authorization: value },
        },
      };
    },
    middleware: async (ctx, next) => {
      if (!refreshFn || ctx.meta?.bearerAuth === false) return next(ctx);
      // The refresh's own call goes out as if it had meta.bearerAuth: false.
      if (inRefresh) {
        return next({ ...ctx, meta: { ...ctx.meta, bearerAuth: false } });
      }
      // A stream is read by the first try; there is nothing left to resend.
      if (isReadableStream(ctx.init.body)) return next(ctx);
      try {
        return await next(ctx);
      } catch (error) {
        if (!isArthronError(error) || error.status !== 401) throw error;
        if (!ours(error.requestContext.url)) throw error;
        // Refresh only if the token that failed is still the current one —
        // otherwise another call has refreshed it already.
        if (
          error.requestContext.init.headers.authorization === (await bearer())
        ) {
          refreshing ??= startRefresh(refreshFn);
          await refreshing;
        }
        return next(ctx);
      }
    },
  };
}
