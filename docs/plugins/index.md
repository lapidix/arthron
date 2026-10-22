# Plugins

A plugin hooks into the calls a client sends. This page covers what a plugin is made of, the built-in plugins, and the order to put them in.

## What a plugin is

A plugin is an object with a required `pluginName` and at least one of four slots:

```ts
type Plugin = {
  // Required. The plugin's identity: use/extend replace the
  // plugin of the same pluginName, and without(pluginName)
  // removes it. Not `name`: a function has one.
  pluginName: string;
  middleware?: (
    requestContext: RequestContext,
    next: (requestContext: RequestContext) => Promise<Response>,
  ) => Promise<Response>;
  requestInterceptor?: (
    requestContext: RequestContext,
  ) => RequestContext | Promise<RequestContext>;
  responseInterceptor?: (
    response: Response,
    requestContext: RequestContext,
  ) => Response | Promise<Response>;
  errorInterceptor?: (
    error: ArthronError,
    requestContext: RequestContext,
  ) => ArthronError | Promise<ArthronError>;
};
```

### The request context

Every slot receives the request context:

```ts
type RequestContext = {
  url: string;
  // Header names are lowercase.
  init: Omit<RequestInit, "headers"> & {
    headers: Record<string, string>;
  };
  // Per-call plugin settings, never sent.
  meta: ArthronMeta;
  // The function this attempt is sent with: the client's
  // fetchFn, else the global fetch. Replace it to send
  // another way, wrap it to observe.
  fetchFn?: typeof fetch;
};
```

## Middleware and interceptors

Middleware controls the flow of a call. Interceptors transform the values of one attempt.

[Middleware and interceptors](/plugins/middleware-and-interceptors) covers what each one gets and returns, when it runs, and which to use.

## Built in {#built-in}

The built-in plugins come from `arthron/plugins`:

```ts
import {
  bearerAuth,
  logging,
  retry,
  timeout,
  uploadProgress,
} from "arthron/plugins";
```

So do their types: `BearerAuthOptions`, `LoggingOptions`, `LogEvent`, `RetryOptions`, `TimeoutOptions`, `UploadProgressEvent`.

They are plain plugins. Anything they do, yours can.

| Plugin | What it does | Slots | Per call |
| --- | --- | --- | --- |
| [`retry`](/plugins/retry) | Repeats a failed attempt | Middleware | `meta: { retry: false \| options }` |
| [`timeout`](/plugins/timeout) | Aborts a slow or silent call | Middleware | `meta: { timeout: false \| ms \| { total?, idle? } }` |
| [`logging`](/plugins/logging) | One line per call start and end | Middleware | — |
| [`bearerAuth`](/plugins/bearer-auth) | Sends a token, refreshes on 401 | Request interceptor (the header) and middleware (the refresh) | `meta: { bearerAuth: false }` |
| [`uploadProgress`](/plugins/upload-progress) | Reports upload progress | Request interceptor (swaps `requestContext.fetchFn`) | `meta: { uploadProgress: { onProgress } }`; only the calls that pass it report progress |

## Plugin order

Order matters: the first plugin is the outermost. A good default:

```ts
plugins: [logging(), bearerAuth(…), timeout(10_000), retry()]
```

- `logging` first logs each call once: its start, and its end with the total time, retries included.
- A `timeout` before `retry` bounds the whole call. After `retry`, it bounds each attempt, and by default a timed-out attempt is not retried.
- `bearerAuth` sets its header on every attempt, wherever it sits.
- Anything that should see only the final outcome goes before `retry`: an [error page](/plugins/recipes#send-users-to-an-error-page), or mapping to domain errors.

### Two of the same plugin

Plugins with the same `pluginName` replace each other. A second `timeout()` takes the first one's place instead of adding a deadline.

For both a total and a per-attempt deadline, rename one:

```ts
plugins: [
  // 30 s in all
  { ...timeout(30_000), pluginName: "callTimeout" },
  retry(),
  // 10 s per attempt
  timeout(10_000),
]
```

## Types

All three come from `arthron`. The types of the four slots are on [Middleware and interceptors](/plugins/middleware-and-interceptors#types); the built-ins' own option and event types come from `arthron/plugins` and are listed under [Built in](#built-in).

| Type | What it is |
| --- | --- |
| `Plugin` | A plugin: a `pluginName` and at least one of the four slots |
| `RequestContext` | What plugins see and return; the whole type is under [The request context](#the-request-context) |
| `ArthronMeta` | The type of `meta`, the per-call plugin settings; see [Per-call settings](/plugins/write-your-own#per-call-settings) |
