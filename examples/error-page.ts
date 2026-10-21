// Send users to an error page when a GET finally fails.
//
// Navigation reacts to the outcome of the *call*, not of one attempt, so it
// is middleware placed before retry(): it sees only the final result. An
// error interceptor would run on every failed attempt — navigating away even
// when the next retry succeeds.
import { arthron, definePlugin, isArthronError } from "../src";
import { retry } from "../src/plugins";

export const errorRedirect = (navigate: (to: string) => void) =>
  definePlugin({
    name: "errorRedirect",
    middleware: async (ctx, next) => {
      try {
        return await next(ctx);
      } catch (error) {
        if (isArthronError(error) && (ctx.init.method ?? "GET") === "GET") {
          if (error.status === 404) navigate("/not-found");
          else if (error.status >= 500) navigate("/error");
        }
        throw error;
      }
    },
  });

// Usage — first in `use`, so it wraps retry().
const navigate = (to: string) => console.log(`navigate → ${to}`);
export const api = arthron({
  baseURL: "https://api.example.com",
  plugins: [errorRedirect(navigate), retry()],
});
