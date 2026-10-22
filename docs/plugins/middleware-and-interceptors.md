<script setup>
import CallLayers from "../.vitepress/theme/CallLayers.vue";
</script>

# Middleware and interceptors

A plugin does its work in two kinds of slots. Middleware controls the flow of a call; interceptors transform the values of one attempt. This page covers what each one gets and returns, when it runs, and which to reach for.

## At a glance

The plugins of `[logging(), timeout(10_000), retry()]` around one attempt:

<CallLayers />

| Aspect | Middleware | Interceptor |
| --- | --- | --- |
| Runs | Around everything below it: once per call, or again each time a middleware above it calls `next` again | Once per attempt |
| Gets | `requestContext` and `next` | A value: context, `Response`, or `ArthronError` |
| Can | Call `next` again (retry), skip it, add a deadline | Return a changed value |
| Cannot | — | Retry, skip, or stop the error from being thrown |
| Examples | `retry`, `timeout`, `logging`, auth refresh, error pages | Auth header, tracing id, enriching one attempt's error |

A plugin may fill both kinds. [`bearerAuth`](/plugins/bearer-auth) sets its header with a request interceptor and refreshes the session with a middleware.

## Middleware

A middleware wraps the whole call and decides its flow.

```ts
const timing = createPlugin({
  pluginName: "timing",
  middleware: async (requestContext, next) => {
    const started = Date.now();
    try {
      return await next(requestContext);
    } finally {
      console.log(requestContext.url, Date.now() - started);
    }
  },
});
```

Add it with `plugins: [timing]` or `api.use(timing)`.

### What it gets and returns

| Slot | Runs | Gets | Returns |
| --- | --- | --- | --- |
| `middleware` | Around everything below it | `requestContext`, `next` | The `Response` to pass on, as a promise |

`await next(requestContext)` runs everything below it: the middleware after it, then the attempt (request interceptors, fetch, response or error interceptors). It resumes with the `Response`, or with the error to `catch`.

### What it can do

- Call `next` again, which is a retry.
- Not call `next` at all, and return a `Response` of its own.
- Return a different `Response` than the one `next` gave.
- Catch what `next` rejects with: an `ArthronError`, or the untouched original when the failure was a cancellation or a bug in a plugin.

### When it runs

The outermost middleware runs once per call. A middleware below one that calls `next` again runs again each time.

With `plugins: [retry(), timeout(5_000)]`, the timeout runs inside `retry`, so it applies to each attempt. See [Plugin order](/plugins/#plugin-order).

### Watch out for

- Inside `try`, write `return await next(requestContext)`. Without `await`, the `catch` never sees the error; see [Await next inside try](/plugins/write-your-own#await-next-inside-try).

## Interceptors

An interceptor changes one value of each attempt: the request, the response or the error.

```ts
const traced = createPlugin({
  pluginName: "trace",
  // before each attempt: a fresh trace id
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
  // after each successful attempt: note the server's timing
  responseInterceptor: (response) => {
    recordTiming(response.headers.get("server-timing"));
    return response;
  },
  // after each failed attempt: report it; it is thrown anyway
  errorInterceptor: (error) => {
    report(error.toJSON());
    return error;
  },
});
```

Add it with `plugins: [traced]` or `api.use(traced)`. `recordTiming` and `report` stand for helpers of your own; a plugin may fill any one of the three slots on its own.

### What it gets and returns

| Slot | Runs | Gets | Returns |
| --- | --- | --- | --- |
| `requestInterceptor` | Before each attempt | `requestContext` | The context to send, which may be a new object |
| `responseInterceptor` | After a successful attempt | `response`, `requestContext` | The `Response` to pass on |
| `errorInterceptor` | After a failed attempt | `error` (an `ArthronError`), `requestContext` | The error to throw; it is always thrown |

### What it can do

- Return a changed copy of its value, or the value as it is.
- It cannot retry, skip the request, or stop the error from being thrown; that is what middleware is for.
- Error interceptors see only an `ArthronError`: a non-ok response or a failed fetch. Cancellation and exceptions thrown by plugins skip them.

### When it runs

Interceptors run on every attempt, inside every middleware. Request interceptors are not the outermost layer, as axios users may expect.

That is also why a `timeout` covers a slow interceptor: the interceptor's time counts toward the deadline. The interceptor itself is cut off at the deadline only if it listens to `requestContext.init.signal`. Otherwise it runs to the end, and fetch, given the aborted signal, rejects the call with a `TimeoutError`.

### Watch out for

- `requestContext.init.headers` is always a plain record with lowercased names. It is restored to that shape after every request interceptor, so `{ ...requestContext.init.headers, name: value }` is safe.
- Response bodies are single-use. A response interceptor that wants to inspect the body must call `response.clone()`; one that changes the body returns a new `Response`.

## Which one to use

| You want to | Use |
| --- | --- |
| Retry, set a deadline, or skip the request | A middleware |
| React to how the call ended, such as sending users to an error page | A middleware before `retry()`; see [Send users to an error page](/plugins/recipes#send-users-to-an-error-page) |
| Send a value that must be fresh on every attempt: a token, a signature with a timestamp, a span id | A request interceptor |
| Send a value that must be the same on every attempt, such as an idempotency key | A middleware before `retry()`; see [Per attempt or per call](/plugins/write-your-own#per-attempt-or-per-call) |
| Change a successful `Response` | A response interceptor |
| Enrich one attempt's error | An error interceptor |

## Types

All four come from `arthron`. For a slot written on its own, `createMiddleware`, `createRequestInterceptor`, `createResponseInterceptor` and `createErrorInterceptor` type it; see [One piece on its own](/plugins/write-your-own#one-piece-on-its-own).

| Type | What it is |
| --- | --- |
| `Middleware` | The `middleware` slot: wraps the call, and `next` runs everything below it |
| `RequestInterceptor` | The `requestInterceptor` slot: runs before each attempt and returns the context to send |
| `ResponseInterceptor` | The `responseInterceptor` slot: runs after a successful attempt and returns the `Response` |
| `ErrorInterceptor` | The `errorInterceptor` slot: runs after a failed attempt and returns the error, which is always thrown |
