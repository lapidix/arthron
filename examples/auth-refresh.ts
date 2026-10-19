// Bearer token with silent refresh on 401.
//
// The two halves live in different slots on purpose:
// - attaching the header is a *value* change → request interceptor
// - "refresh, then redo the request" is *flow* → middleware
// Because `next` re-runs the request interceptors, the retried attempt picks
// up the new token without any extra wiring.
import { arthron, definePlugin, isArthronError } from "../src";

type TokenStore = {
  token: () => string | null;
  refresh: () => Promise<void>;
};

export const auth = (store: TokenStore) =>
  definePlugin({
    name: "auth",
    request: (ctx) => {
      const token = store.token();
      if (!token) return ctx;
      return {
        ...ctx,
        init: {
          ...ctx.init,
          headers: { ...ctx.init.headers, authorization: `Bearer ${token}` },
        },
      };
    },
    middleware: async (ctx, next) => {
      try {
        return await next(ctx);
      } catch (error) {
        if (!isArthronError(error) || error.status !== 401) throw error;
        await store.refresh(); // if this throws, the caller decides (log out, etc.)
        return next(ctx);
      }
    },
  });

// Usage — any store works; this one keeps the token in memory.
let current: string | null = null;
const api = arthron({
  baseURL: "https://api.example.com",
  use: [
    auth({
      token: () => current,
      refresh: async () => {
        const res = await fetch("https://api.example.com/token/refresh", {
          method: "POST",
          credentials: "include",
        });
        current = ((await res.json()) as { access_token: string }).access_token;
      },
    }),
  ],
});

export const me = () => api.get("/me").json<{ id: string; name: string }>();
