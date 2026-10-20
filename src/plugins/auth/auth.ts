import { isArthronError } from "../../error/arthron-error";
import { isReadableStream } from "../../request/body";
import type { Plugin } from "../../types/plugin.types";
import type { AuthOptions } from "./auth.types";

/** The origin of an absolute http(s) URL; `undefined` for anything else. */
function originOf(url: string): string | undefined {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : undefined;
  } catch {
    return undefined;
  }
}

function allowedOrigins(origin: AuthOptions["origin"]): Set<string> {
  const urls = typeof origin === "string" ? [origin] : origin;
  if (urls.length === 0) {
    throw new TypeError(
      'arthron: auth({ origin }) needs at least one URL — e.g. origin: "https://api.example.com"',
    );
  }
  return new Set(
    urls.map((url) => {
      const found = originOf(url);
      if (found) return found;
      throw new TypeError(
        `arthron: auth({ origin }) needs an http(s) URL, got ${JSON.stringify(url)} — e.g. origin: "https://api.example.com"`,
      );
    }),
  );
}

/**
 * Bearer-token auth. A request interceptor sets `authorization: Bearer
 * <token>` on every attempt to `origin`; with `refresh`, a middleware turns a
 * 401 into one refresh and one more try. Concurrent 401s share the refresh
 * (with refresh-token rotation, parallel refreshes revoke each other), and a
 * call whose token was replaced meanwhile just retries. A call opts out with
 * `meta: { auth: false }`.
 */
export function auth(options: AuthOptions): Plugin {
  const { token, refresh } = options;
  const allowed = allowedOrigins(options.origin);
  const ours = (url: string) => allowed.has(originOf(url) ?? "");
  const bearer = async () => {
    const value = await token();
    return value ? `Bearer ${value}` : undefined;
  };
  let refreshing: Promise<void> | undefined;

  return {
    name: "auth",
    request: async (ctx) => {
      if (ctx.meta?.auth === false || !ours(ctx.url)) return ctx;
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
      if (!refresh || ctx.meta?.auth === false) return next(ctx);
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
          refreshing ??= refresh().finally(() => {
            refreshing = undefined;
          });
          await refreshing;
        }
        return next(ctx);
      }
    },
  };
}
