# Recipes

**Attach a trace id.** A request interceptor that returns a changed copy.

```ts
const traced = api.use({
  pluginName: "trace",
  requestInterceptor: (requestContext) => ({
    ...requestContext,
    init: {
      ...requestContext.init,
      headers: { ...requestContext.init.headers, "x-trace-id": crypto.randomUUID() },
    },
  }),
});
```

**Send users to an error page.** This reacts to how the *call* ended, so it is middleware placed before `retry()`: it sees only the final result. An error interceptor would run on every failed attempt and navigate away even when the next retry succeeds. Error interceptors are for enriching the error of one attempt. Tested in [`examples/error-page.ts`](https://github.com/lapidix/arthron/blob/main/examples/error-page.ts).

```ts
import { createPlugin, isArthronError } from "arthron";

export const errorRedirect = (navigate: (to: string) => void) =>
  createPlugin({
    pluginName: "errorRedirect",
    middleware: async (requestContext, next) => {
      try {
        return await next(requestContext);
      } catch (error) {
        if (isArthronError(error) && (requestContext.init.method ?? "GET") === "GET") {
          if (error.status === 404) navigate("/not-found");
          else if (error.status >= 500) navigate("/error");
        }
        throw error;
      }
    },
  });

const api = arthron({ baseURL: API, plugins: [errorRedirect(router.push), retry()] }); // first: wraps retry
```

The same shape maps errors to your own types: `catch (error) { throw toDomainError(error); }` in an outermost middleware runs once per call, after retries.

**Refresh a session on 401, then redo the request.** That is the built-in [`bearerAuth()`](/plugins/bearer-auth), and a model for your own: the refresh is flow, so it is middleware; the header is a value, so it is a request interceptor — and because `next` re-runs the interceptors, the redone request carries the new token without extra code. Read [`src/plugins/bearer-auth/bearer-auth.ts`](https://github.com/lapidix/arthron/blob/main/src/plugins/bearer-auth/bearer-auth.ts) before writing a variant for another scheme.
