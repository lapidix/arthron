# Write your own

A plugin of your own is a plain object, like the built-ins. This page covers `createPlugin` and its helpers, where a value belongs, and the settings a call can pass to your plugin.

## Create a plugin

`createPlugin` takes a plugin and returns it. It types the plugin without annotations and checks it where you write it.

These are a `TypeError` that says what to write:

- a missing `pluginName`
- an unknown key, such as a typo
- a 1.x key: `name`, `request`, `response` or `error`
- a slot that is not a function
- a plugin with nothing to run

`use` and `plugins` run the same check.

### Keep state in a closure

A plugin is a plain object. To keep state, close over it in a function that returns `createPlugin({ … })`. The built-ins keep theirs the same way: each is a function that closes over its state and returns the plugin.

### One piece on its own

For a piece written on its own, these helpers type it the same way. Each name is `create` plus the type's name.

| Helper | What it types |
| --- | --- |
| `createMiddleware` | a `Middleware` |
| `createRequestInterceptor` | a `RequestInterceptor` |
| `createResponseInterceptor` | a `ResponseInterceptor` |
| `createErrorInterceptor` | an `ErrorInterceptor` |

## Await next inside try

::: warning
Write `return await next(requestContext)` inside `try`. Without `await`, the promise is returned before it settles, and the `catch` never sees its error.
:::

## Per attempt or per call

A request interceptor runs on every attempt. It fits a value that must be fresh each time:

- a token
- a signature with a timestamp
- a span id

A value that must be the same on every attempt is set once, by a middleware placed before `retry()`. An idempotency key is one: it lets the server tell a retry from a second payment.

```ts
const idempotent = createMiddleware((requestContext, next) =>
  next({
    ...requestContext,
    init: {
      ...requestContext.init,
      headers: {
        ...requestContext.init.headers,
        "idempotency-key": crypto.randomUUID(),
      },
    },
  }),
);
// A client of its own, so the order is exactly this:
// the key first, then retry.
const payments = arthron({
  baseURL: API,
  plugins: [
    { pluginName: "idempotency", middleware: idempotent },
    retry({ methods: ["POST"] }),
  ],
});
```

### Why not api.use

`api.use(…)` would not do here if `api` already has a `retry()`. The new `retry()` takes the old one's place, which may be before the key. The key would then be made again on every attempt.

## Per-call settings

`api.get(path, { meta })` hands `meta` to every plugin as `requestContext.meta`. It is never sent.

Declare your own keys once, and they are typed everywhere:

```ts
declare module "arthron" {
  interface ArthronMeta {
    skipTrace?: boolean;
  }
}

const traced = api.use({
  pluginName: "trace",
  requestInterceptor: (requestContext) =>
    requestContext.meta.skipTrace
      ? requestContext
      : withTraceId(requestContext),
});
traced.get("/health", { meta: { skipTrace: true } });
```

`withTraceId` stands for a helper of your own, such as the interceptor in [Attach a trace id](/plugins/recipes#attach-a-trace-id).

## Adding your own options

These public object types are interfaces:

- `ArthronClientOptions`
- `RequestOptions`
- `RequestOptionsWithMethod`
- `RequestContext`
- `ArthronMeta`
- `Plugin`
- `ResponsePromise`
- `ArthronClient`
- `ArthronSchema`

So a plugin package can add its own options to any of them, the way `ArthronMeta` gets `skipTrace` above:

```ts
declare module "arthron" {
  interface RequestOptions {
    // …
  }
}
```
