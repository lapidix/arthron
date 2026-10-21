# Write your own

`createPlugin` takes a plugin and returns it, typed without annotations and checked where you write it: a missing `pluginName`, an unknown key (a typo), a 1.x `name`, `request`, `response` or `error`, a slot that is not a function or a plugin with nothing to run is a `TypeError` that says what to write. `use` and `plugins` run the same check. A plugin is a plain object: to keep state, close over it in a function that returns `createPlugin({ … })`, as the built-ins do. For a piece written on its own, `createMiddleware`, `createRequestInterceptor`, `createResponseInterceptor` and `createErrorInterceptor` type it the same way — `create` plus the type's name.

**`return await next(requestContext)` inside `try`.** Without `await`, the promise is returned before it settles, and the `catch` never sees its error.

**Per attempt or per call.** A request interceptor runs on every attempt, so it fits a value that must be fresh each time: a token, a signature with a timestamp, a span id. A value that must be the same on every attempt — an idempotency key, so the server can tell a retry from a second payment — is set once, by a middleware placed before `retry()`:

```ts
const idempotent = createMiddleware((requestContext, next) =>
  next({
    ...requestContext,
    init: {
      ...requestContext.init,
      headers: { ...requestContext.init.headers, "idempotency-key": crypto.randomUUID() },
    },
  }),
);
// A client of its own, so the order is exactly this: the key first, then retry.
const payments = arthron({
  baseURL: API,
  plugins: [{ pluginName: "idempotency", middleware: idempotent }, retry({ methods: ["POST"] })],
});
```

(`api.use(…)` would not do here if `api` already has a `retry()`: the new one takes the old one's place, which may be before the key.)

**Per-call settings.** `api.get(path, { meta })` hands `meta` to every plugin as `requestContext.meta` and never sends it. Declare your own keys once and they are typed everywhere:

```ts
declare module "arthron" {
  interface ArthronMeta {
    skipTrace?: boolean;
  }
}

const traced = api.use({
  pluginName: "trace",
  requestInterceptor: (requestContext) =>
    requestContext.meta.skipTrace ? requestContext : withTraceId(requestContext),
});
traced.get("/health", { meta: { skipTrace: true } });
```
