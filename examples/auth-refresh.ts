// Bearer token with silent refresh on 401.
//
// The two halves live in different slots on purpose:
// - attaching the header is a *value* change → request interceptor
// - "refresh, then redo the request" is *flow* → middleware
// Because `next` re-runs the request interceptors, the retried attempt picks
// up the new token without any extra wiring.
//
// Two details make it safe beyond a demo:
// - Single flight. Concurrent 401s share one refresh, and a call whose token
//   was already replaced just retries. With refresh-token rotation, parallel
//   refreshes would revoke each other and log the user out.
// - Origin check. The token goes to the API's origin only, never to an
//   absolute URL elsewhere (a CDN link, a URL from a response body).
import { arthron, definePlugin, isArthronError } from "../src";

export type TokenStore = {
  token: () => string | null;
  /** Fetch a new token; throw when that fails — the caller sees the error. */
  refresh: () => Promise<void>;
};

export const auth = (store: TokenStore, origin: string) => {
  let refreshing: Promise<void> | undefined;
  const bearer = () => {
    const token = store.token();
    return token ? `Bearer ${token}` : undefined;
  };
  return definePlugin({
    name: "auth",
    request: (ctx) => {
      const value = bearer();
      if (!value || new URL(ctx.url).origin !== origin) return ctx;
      return {
        ...ctx,
        init: {
          ...ctx.init,
          headers: { ...ctx.init.headers, authorization: value },
        },
      };
    },
    middleware: async (ctx, next) => {
      try {
        return await next(ctx);
      } catch (error) {
        if (!isArthronError(error) || error.status !== 401) throw error;
        // Refresh only if the token that failed is still the current one —
        // otherwise another call has refreshed it already.
        if (error.request.init.headers.authorization === bearer()) {
          refreshing ??= store.refresh().finally(() => {
            refreshing = undefined;
          });
          await refreshing;
        }
        return next(ctx);
      }
    },
  });
};

// Usage — any store works; this one keeps the token in memory.
const API = "https://api.example.com";
let current: string | null = null;
const api = arthron({
  baseURL: API,
  use: [
    auth(
      {
        token: () => current,
        refresh: async () => {
          const res = await fetch(`${API}/token/refresh`, {
            method: "POST",
            credentials: "include",
          });
          if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
          current = ((await res.json()) as { access_token: string })
            .access_token;
        },
      },
      API,
    ),
  ],
});

export const me = () => api.get("/me").json<{ id: string; name: string }>();
