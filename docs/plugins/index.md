# Overview

A plugin is an object with a required `pluginName` and at least one of four slots:

```ts
type Plugin = {
  pluginName: string; // required — identity: use/extend replace the plugin of the same pluginName, without(pluginName) removes it. Not `name`: a function has one
  middleware?: (requestContext: RequestContext, next: (requestContext: RequestContext) => Promise<Response>) => Promise<Response>;
  requestInterceptor?: (requestContext: RequestContext) => RequestContext | Promise<RequestContext>;
  responseInterceptor?: (response: Response, requestContext: RequestContext) => Response | Promise<Response>;
  errorInterceptor?: (error: ArthronError, requestContext: RequestContext) => ArthronError | Promise<ArthronError>;
};

type RequestContext = {
  url: string;
  init: Omit<RequestInit, "headers"> & { headers: Record<string, string> }; // lowercase names
  meta: ArthronMeta; // per-call plugin settings, never sent
  fetchFn?: typeof fetch; // the function this attempt is sent with (the client's fetchFn, else the global fetch) — replace it to send another way, wrap it to observe
};
```

| | Middleware | Interceptor |
|---|---|---|
| Runs | Once per call, wrapping everything below | Once per attempt |
| Gets | `requestContext` and `next` | A value: context, `Response`, or `ArthronError` |
| Can | Call `next` again (retry), skip it, add a deadline | Return a changed value |
| Cannot | — | Retry, skip, or stop the error from being thrown |
| Examples | `retry`, `timeout`, `logging`, auth refresh, error pages | auth header, tracing id, enriching one attempt's error |

Request interceptors are not the outermost layer, as axios users may expect: they run inside every middleware, on every attempt — which is also why a `timeout` bounds a slow interceptor. `requestContext.init.headers` is always a plain record with lowercased names, restored to that shape after every request interceptor, so `{ ...requestContext.init.headers, name: value }` is safe. Response bodies are single-use: a response interceptor that wants to inspect the body must `response.clone()`; one that changes it returns a new `Response`.

## Built in {#built-in}

The built-in plugins come from `arthron/plugins`: `import { bearerAuth, logging, retry, timeout, uploadProgress } from "arthron/plugins"`. So do their types: `BearerAuthOptions`, `LoggingOptions`, `LogEvent`, `RetryOptions`, `TimeoutOptions`, `UploadProgressEvent`. They are plain plugins — anything they do, yours can.

| plugin | what it does | slots | per call |
|---|---|---|---|
| [`retry`](/plugins/retry) | repeats a failed attempt | middleware | `meta: { retry: false \| options }` |
| [`timeout`](/plugins/timeout) | aborts a slow or silent call | middleware | `meta: { timeout: false \| ms \| { total?, idle? } }` |
| [`logging`](/plugins/logging) | one line per call start and end | middleware | — |
| [`bearerAuth`](/plugins/bearer-auth) | sends a token, refreshes on 401 | request interceptor (the header) + middleware (the refresh) | `meta: { bearerAuth: false }` |
| [`uploadProgress`](/plugins/upload-progress) | reports upload progress | request interceptor (swaps `requestContext.fetchFn`) | `meta: { uploadProgress: { onProgress } }` — only calls that pass it |

Order is meaning: the first plugin is outermost. A good default:

```ts
plugins: [logging(), bearerAuth(…), timeout(10_000), retry()]
```

`logging` first logs each call once — its start, and its end with the total time, retries included. A `timeout` before `retry` bounds the whole call; after it, each attempt — and a timed-out attempt is not retried. `bearerAuth` sets its header on every attempt wherever it sits. Anything that should see only the final outcome — an error page, mapping to domain errors — goes before `retry`.

Plugins with the same `pluginName` replace each other, so a second `timeout()` takes the first one's place instead of adding a deadline. For both a total and a per-attempt deadline, rename one:

```ts
plugins: [{ ...timeout(30_000), pluginName: "callTimeout" }, retry(), timeout(10_000)] // 30 s in all, 10 s per attempt
```
