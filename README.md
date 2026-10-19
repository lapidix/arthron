# arthron

**Middleware owns the flow — it can call `next` again to retry the whole request. Interceptors only transform values and can never change the flow. arthron keeps the two apart at the type level.**

A composable `fetch` client. Create one from config, plug in interceptors and middleware, get a plain `Response` back. Zero dependencies, TypeScript first, Node 18+ and browsers.

## Install

```sh
npm i arthron
```

## Quick start

```ts
import { arthron, logging, retry, timeout } from "arthron";

const base = arthron({
  baseURL: "https://api.example.com",
  use: [logging(), timeout(10_000), retry({ retries: 3 })],
});

const api = base.extend({
  use: [auth({ getToken, refresh })], // your own plugin — see "Writing your own plugin"
});

const res = await api.get("/me");                             // Response
const user = await api.get("/me").json<User>();               // parsed body
const blob = await api.get("/export").blob();
const stream = (await api.post("/chat", { prompt })).body;    // ReadableStream
```

## Concepts

One request runs like this:

```
middleware[0] (
  middleware[1] (
    ...
      attempt: request interceptors → fetch → ok ? response interceptors : error interceptors → throw
  )
)
```

- **Middleware** wraps the whole call, outermost first in registration order. `next(ctx)` runs everything beneath it; calling `next` again re-runs the whole attempt — that is how retry, auth refresh and timeouts are built.
- **Interceptors** run inside each attempt. They receive a value (`RequestContext`, `Response`, or `ArthronError`) and return one. They cannot skip, retry, or swallow — an error interceptor's return value is always thrown.
- Every attempt starts from a **copy** of the context, so headers an interceptor set on attempt one do not leak into attempt two.

A plugin is just an object bundling any of the four:

```ts
type Plugin = {
  name?: string;
  middleware?: (ctx, next) => Promise<Response>;
  request?:    (ctx) => RequestContext | Promise<RequestContext>;
  response?:   (res, ctx) => Response | Promise<Response>;
  error?:      (err, ctx) => ArthronError | Promise<ArthronError>;
};
```

## API

### `arthron(config)`

```ts
type ArthronConfig = {
  baseURL?: string;                 // prefix for relative paths; without it only absolute URLs are accepted
  headers?: HeadersInit;            // defaults; per-call headers win, compared case-insensitively
  credentials?: RequestCredentials; // forwarded as-is; NOT set unless you set it
  fetch?: typeof fetch;             // injection point for tests / polyfills
  use?: Plugin[];
  errorMessage?: (data: unknown, res: Response) => string | undefined;
};
```

### Instance

```ts
api.get(path, init)             api.delete(path, init)         api.head(path, init)
api.post(path, body, init)      api.put(path, body, init)      api.patch(path, body, init)
api.request(path, { method, body, ...init })

api.use(...plugins)   // new client with plugins appended
api.extend(config)    // new client: config shallow-merged, headers merged, plugins appended
```

Every argument except `path` (and `method` for `request`) is optional. `init` is `RequestInit` minus `method`/`body`, plus `params` (query object; `null`/`undefined` skipped, appended with `&` if the path already has a query).

Clients are **immutable**. `use` and `extend` return new clients; the receiver — and anything previously derived from it — is untouched.

**Body rules.** `string`, `FormData`, `Blob`, `ArrayBuffer`/views, `URLSearchParams`, `ReadableStream` are sent as-is with no `Content-Type` added. Anything else — including `null` — is `JSON.stringify`-ed with `content-type: application/json`, unless you already set a content type. `GET`/`HEAD` with a body is rejected up front with a `TypeError`.

**URL rules.** `baseURL` and `path` are joined by string concatenation — `"https://a/v1" + "/users"` → `https://a/v1/users`. The prefix survives a leading slash (unlike `new URL()`). Absolute paths skip `baseURL`.

### Return value — `ArthronPromise`

Every method returns `Promise<Response>` with convenience helpers:

```ts
const res  = await api.get("/me");                 // Response, untouched
const body = await api.get("/me").json<User>();    // (await res).json() — T is a cast, not validation
                     .text() .blob() .arrayBuffer() .formData()
```

A `204`/empty body makes `.json()` reject, exactly like `Response.json()` would.

### Errors — `ArthronError`

```ts
class ArthronError extends Error {
  status: number;        // HTTP status; 0 for network failures
  statusText: string;
  headers: Headers;
  data: unknown;         // parsed body: JSON if it parses, else text, else undefined
  response?: Response;   // the original; its body is already consumed into `data`. Absent for network failures
  request: RequestContext;
  cause?: unknown;       // the original error for network failures
}
```

Only two things become an `ArthronError`: a response with `ok === false`, and `fetch` itself rejecting (network failure, `status: 0`). **Everything else is rethrown untouched and skips the error interceptors** — `AbortError`, `TimeoutError`, and anything a plugin throws. A bug in an interceptor is a bug, not a 500.

The message is picked from the body by `message` → `error` (string) → `error.message` → `detail`, falling back to `Request failed with status N`. Override with `errorMessage` in the config.

```ts
import { isArthronError } from "arthron";

try { await api.get("/me"); }
catch (e) { if (isArthronError(e) && e.status === 404) { /* … */ } else throw e; }
```

## Built-in plugins

### `logging(options)`

One line when a request starts, one when it settles. The query string is dropped (it tends to carry tokens). Cancellations are not logged.

| option | default | |
|---|---|---|
| `enabled` | `true` | arthron never reads `NODE_ENV` — pass `isDev` yourself |
| `logger` | `console` | needs `log` and `error` |

```
[arthron] → GET /users
[arthron] ← GET /users 200 42ms
[arthron] ✕ GET /users 503 1203ms
```

### `retry(options)`

Retries by calling `next` again, so request interceptors (fresh auth header, fresh trace id) run on every attempt.

| option | default | |
|---|---|---|
| `retries` | `2` | retries *after* the first attempt — 3 requests total |
| `retryOn` | `[408, 429, 500, 502, 503, 504]` | network failures (`status 0`) are always retried |
| `methods` | `GET HEAD OPTIONS PUT DELETE` | case-insensitive |
| `delay` | `retry => 300 * 2 ** retry` | ms; `retry` is 0-based |
| `maxRetryAfter` | `60_000` | a `Retry-After` longer than this (ms) means "don't retry" |

`Retry-After` (seconds or HTTP-date) wins over `delay` when present and within `maxRetryAfter`; beyond it the error is thrown without retrying. `ReadableStream` bodies are never retried (they can only be read once). Respects `signal` — an aborted request stops retrying immediately.

### `timeout(ms)`

Aborts the attempt after `ms` and rejects with a `TimeoutError` (a `DOMException`, the same thing `AbortSignal.timeout()` produces). It is **not** an `ArthronError`, so error interceptors and `retry` leave it alone. Combines with a `signal` you pass yourself; built on `AbortController` so it runs on Node 18.

Order matters: put `timeout` *inside* `retry` (register it after) so each attempt gets its own deadline, or *outside* for one deadline across all attempts.

```ts
arthron({ use: [retry(), timeout(5_000)] }); // 5 s per attempt
arthron({ use: [timeout(5_000), retry()] }); // 5 s total
```

## Writing your own plugin

`defineMiddleware`, `defineInterceptor.{request,response,error}` and `definePlugin` are identity functions that give you contextual typing. Use them or annotate — same result.

### `auth` — refresh on 401, then re-run the request

This is the case the middleware/interceptor split exists for. The refresh and the retry are *flow*, so they live in middleware. Attaching the header is a *value change*, so it is a request interceptor — and because every `next` re-runs the interceptors, the retried request automatically picks up the new token.

```ts
import { definePlugin, isArthronError } from "arthron";

export const auth = ({ getToken, refresh }: {
  getToken: () => string | null;
  refresh: () => Promise<void>;
}) =>
  definePlugin({
    name: "auth",
    request: (ctx) => {
      const token = getToken();
      if (!token) return ctx;
      return { ...ctx, init: { ...ctx.init, headers: { ...ctx.init.headers, authorization: `Bearer ${token}` } } };
    },
    middleware: async (ctx, next) => {
      try {
        return await next(ctx);
      } catch (e) {
        if (!isArthronError(e) || e.status !== 401) throw e;
        await refresh();          // throws → propagates; caller decides to log out
        return next(ctx);         // whole attempt again, request interceptor adds the new token
      }
    },
  });
```

### `errorRedirect` — react to errors without changing them

An error interceptor can only *look* and *return*; it cannot swallow. That makes it the right home for side effects like navigation.

```ts
import { defineInterceptor } from "arthron";

export const errorRedirect = (navigate: (to: string) => void) =>
  defineInterceptor.error((err, ctx) => {
    const isGet = (ctx.init.method ?? "GET") === "GET";
    if (isGet && err.status === 404) navigate("/not-found");
    if (isGet && err.status >= 500) navigate("/error");
    return err; // still thrown
  });

api.use({ error: errorRedirect(router.push) });
```

## Gotchas

- **`Response` bodies are single-use.** A response interceptor that wants to peek must `res.clone()` first; one that wants to change the body returns a new `Response`.
- **`credentials` is not set by default.** Cookie-based sessions need `credentials: "include"` in the config (cross-origin) — arthron will not guess.
- **`baseURL` joining is string concatenation.** `"…/v1"` + `"/users"` keeps `/v1`. Pass an absolute URL to escape the base.
- **Only `!ok` and network failures become `ArthronError`.** Cancellations and plugin exceptions propagate as-is and do not reach error interceptors or `retry`.
- **`.json<T>()` is a cast.** Validate with your schema library if you need to.

## License

MIT
