import { isArthronError } from "../../error/arthron-error";
import { isReadableStream } from "../../request/body";
import { httpOrigin } from "../../request/url";
import type { Plugin } from "../../types/plugin.types";
import type { BearerAuthOptions } from "./bearer-auth.types";

const REPLACED = [
  ["token", "accessTokenFn"],
  ["refresh", "refreshFn"],
] as const;

function allowedOrigins(origin: BearerAuthOptions["origin"]): Set<string> {
  const urls = typeof origin === "string" ? [origin] : origin;
  if (urls.length === 0) {
    throw new TypeError(
      'arthron: bearerAuth({ origin }) needs at least one URL — e.g. origin: "https://api.example.com"',
    );
  }
  return new Set(
    urls.map((url) => {
      const found = httpOrigin(url);
      if (found) return found;
      throw new TypeError(
        `arthron: bearerAuth({ origin }) needs an http(s) URL, got ${JSON.stringify(url)} — e.g. origin: "https://api.example.com"`,
      );
    }),
  );
}

/**
 * Bearer-token auth. A request interceptor sets `authorization: Bearer
 * <token>` on every attempt to `origin`; with `refreshFn`, a middleware turns a
 * 401 into one refresh and one more try. Concurrent 401s share the refresh
 * (with refresh-token rotation, parallel refreshes revoke each other), and a
 * call whose token was replaced meanwhile just retries. A call opts out with
 * `meta: { bearerAuth: false }`.
 */
export function bearerAuth(options: BearerAuthOptions): Plugin {
  // The 1.x names: unknown keys would be ignored, and no token ever sent.
  for (const [old, now] of REPLACED) {
    if ((options as Record<string, unknown>)[old] !== undefined) {
      throw new TypeError(
        `arthron: bearerAuth's ${old} option was replaced by ${now} in 2.0 — pass bearerAuth({ ${now} })`,
      );
    }
  }
  const { accessTokenFn, refreshFn } = options;
  const allowed = allowedOrigins(options.origin);
  const ours = (url: string) => allowed.has(httpOrigin(url) ?? "");
  const bearer = async () => {
    const value = await accessTokenFn();
    return value ? `Bearer ${value}` : undefined;
  };
  let refreshing: Promise<void> | undefined;

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
      // A stream is read by the first try; there is nothing left to resend.
      if (isReadableStream(ctx.init.body)) return next(ctx);
      try {
        return await next(ctx);
      } catch (error) {
        if (!isArthronError(error) || error.status !== 401) throw error;
        if (!ours(error.request.url)) throw error;
        // Refresh only if the token that failed is still the current one —
        // otherwise another call has refreshed it already.
        if (error.request.init.headers.authorization === (await bearer())) {
          refreshing ??= refreshFn().finally(() => {
            refreshing = undefined;
          });
          await refreshing;
        }
        return next(ctx);
      }
    },
  };
}
