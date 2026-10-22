# Recipes

Plugins for common jobs, ready to copy and adapt.

## Attach a trace id

A request interceptor that returns a changed copy of the context:

```ts
const traced = api.use({
  pluginName: "trace",
  requestInterceptor: (requestContext) => ({
    ...requestContext,
    init: {
      ...requestContext.init,
      headers: {
        ...requestContext.init.headers,
        "x-trace-id": crypto.randomUUID(),
      },
    },
  }),
});
```

## Send users to an error page

This reacts to how the call ended, so it is middleware placed before `retry()`. There it sees only the final result.

An error interceptor would not do. It runs on every failed attempt, so it would navigate away even when the next retry succeeds. Error interceptors are for enriching the error of one attempt.

```ts
import { createPlugin, isArthronError } from "arthron";

export const errorRedirect = (navigate: (to: string) => void) =>
  createPlugin({
    pluginName: "errorRedirect",
    middleware: async (requestContext, next) => {
      try {
        return await next(requestContext);
      } catch (error) {
        if (
          isArthronError(error) &&
          (requestContext.init.method ?? "GET") === "GET"
        ) {
          if (error.status === 404) navigate("/not-found");
          else if (error.status >= 500) navigate("/error");
        }
        throw error;
      }
    },
  });

// First: wraps retry.
const api = arthron({
  baseURL: API,
  plugins: [errorRedirect(router.push), retry()],
});
```

This recipe is tested in [`examples/error-page.ts`](https://github.com/lapidix/arthron/blob/main/examples/error-page.ts).

## Map errors to your own types

The same shape maps errors to your own types. Put `catch (error) { throw toDomainError(error); }` in an outermost middleware, before `retry()`. It runs once per call, after the retries.

## Refresh a session on 401 and redo the request

That is the built-in [`bearerAuth()`](/plugins/bearer-auth), and a model for your own:

- The refresh is flow, so it is middleware.
- The header is a value, so it is a request interceptor.

Because `next` re-runs the interceptors, the redone request carries the new token without extra code.

Read [`src/plugins/bearer-auth/bearer-auth.ts`](https://github.com/lapidix/arthron/blob/main/src/plugins/bearer-auth/bearer-auth.ts) before writing a variant for another scheme.
