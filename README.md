# arthron

A `fetch` client you assemble from plugins.

```ts
import { arthron } from "arthron";
import { logging, retry, timeout } from "arthron/plugins";

const api = arthron({
  baseURL: "https://api.example.com",
  plugins: [logging(), timeout(10_000), retry()], // 10 s for the whole call, retries included
});

const user = await api.get("/me").json<User>();
```

- **Plain `Response` in, plain `Response` out.** No wrapper type to learn. `.json<T>()` and friends are there when you want the body.
- **A plugin holds middleware and interceptors, kept apart by the types.** Middleware wraps the call and controls the flow — it can call `next` again to retry, or not at all. Interceptors transform one value and return it; they cannot retry, skip, or swallow. Retry, timeouts, logging, auth refresh, and anything that reacts to how a call ended (error pages, domain errors) are middleware. Headers, trace ids and per-attempt error details are interceptors. One plugin can use both: `bearerAuth` sets the header in an interceptor and refreshes in middleware.
- **One error type, two causes.** `ArthronError` means the server said no (`!response.ok`) or the network failed (`status: 0`). Everything else — cancellation, a bug in a plugin — is rethrown as-is.
- Zero dependencies. ESM and CJS. TypeScript types included, for TypeScript 5.0+. Node 22+ and browsers.

## Install

```sh
npm i arthron
```

## Usage

### Create a client

```ts
const api = arthron({
  baseURL: "https://api.example.com", // prefix for relative paths
  headers: { accept: "application/json" }, // defaults; per-call headers win
  credentials: "include", // only if you need cookies cross-origin
  cache: "no-store", // any fetch option works as a default; per-call values win
  plugins: [retry()], // plugins, outermost first
});
```

Every field is optional. Without `baseURL`, only absolute URLs are accepted. With one, an absolute URL must stay on `baseURL`'s origin or one you list in `allowedOrigins: ["https://cdn.example.com"]` — and config `headers` are only sent to `baseURL`'s origin. Without a `baseURL`, `allowedOrigins` alone limits where requests go.

### Make requests

```ts
await api.get("/users", { queryParams: { page: 2 } }); // → Response
await api.post("/users", { name: "kim" }); // object body → JSON
await api.post("/upload", formData); // FormData/Blob/string/stream → sent as-is
await api.put("/users/1", { name: "lee" });
await api.patch("/users/1", { name: "lee" });
await api.query("/search", { filter: { tag: "x" } }); // RFC 10008 QUERY: GET semantics, body carries the query
await api.delete("/users/1");
await api.head("/users/1");
await api.request("/users", { method: "OPTIONS" });
```

Each call returns `Promise<Response>` with body helpers attached:

```ts
const res = await api.get("/me"); // Response — status, headers, body untouched
const user = await api.get("/me").json<User>(); // body parsed; T is a cast, not validation
const safe = await api.get("/me").json(UserSchema); // validated by any Standard Schema (Zod, Valibot, ArkType); typed from it
const text = await api.get("/robots.txt").text();
const blob = await api.get("/export").blob();
const stream = (await api.post("/chat", prompt)).body; // ReadableStream
for await (const e of api.post("/chat", prompt).sse()) {} // see "Stream responses"
```

`init` accepts everything `fetch` does (`signal`, `cache`, `headers`, …) plus `queryParams`: an object whose `null`/`undefined` values are dropped and whose arrays become repeated keys (`{ ids: [1, 2] }` → `ids=1&ids=2`), or a `URLSearchParams`. Other object values (a `Date`, a nested object) are rejected rather than sent as `[object Object]`. Put ids into the path with `pathParams`, not string interpolation: `api.get("/users/{id}", { pathParams: { id } })` encodes each value into its own segment, so an id like `../admin` or `x?role=admin` cannot change which endpoint you call (`encodeURIComponent` alone lets `..` through). A `null` (or `undefined`) header value drops a client default for that call: `api.get("/public", { headers: { authorization: null } })`.

`query` sends the [RFC 10008](https://www.rfc-editor.org/rfc/rfc10008) QUERY method: safe and idempotent like GET, so `retry()` repeats it by default, but the query travels in the body. Any `fetch` sends it; the server has to understand it (Node's own `http` server does from v20).

### Stream responses

```ts
// Server-sent events — one event per `for await` step
for await (const { event, data } of api.post("/v1/chat/completions", body).sse()) {
  if (data === "[DONE]") break; // provider sentinel; arthron does not interpret it
  process.stdout.write(JSON.parse(data).choices[0].delta.content ?? "");
}

// Newline-delimited JSON (Ollama, many log endpoints)
for await (const row of api.get("/logs").ndjson<LogRow>()) console.log(row);
```

`.sse()` parses `text/event-stream` the way the EventSource spec does: multi-line `data:` joined with `\n`, comments ignored, dispatch on a blank line, an event the stream ends inside dropped, `lastEventId` carried across events, `retry` accepted as digits only and carried on. It does not reconnect — to resume, send `headers: { "last-event-id": e.lastEventId }` on a new request. Both helpers honour `signal` and `timeout` while the body is being read, and leaving the loop early (`break`, `return`, a throw) closes the connection.

A stream is untrusted input, so both helpers have limits: a line longer than `maxLineLength` (default 8 Mi characters), or an SSE event whose `data` outgrows `maxEventSize` (default 8 Mi), rejects the loop with a `RangeError` and closes the connection. Raise them per call if you expect bigger payloads: `.sse({ maxEventSize: 32 * 1024 * 1024 })`.

### Handle errors

```ts
import { isArthronError } from "arthron";

try {
  await api.get("/users/404");
} catch (e) {
  if (isArthronError(e)) {
    e.status; // 404, or 0 when the network failed
    e.payload; // the failed response's body, parsed: JSON, else text; undefined for a network failure
    e.description; // the server's description of the failure (the payload's `message` → `error` → `error.message` → `detail`, or your extractDescription), or undefined — for people
    e.message; // arthron's own: "GET https://api.example.com/users/404 failed with 404 Not Found" — for logs
    e.response; // the failed Response, still readable (up to 64 KiB of its body)
    e.request; // what was sent (url, init) — read it directly; it is left out of logs
  }
}
```

`isArthronError(e)` and `e instanceof ArthronError` work across copies of the package — the ESM and CJS builds loaded side by side, a CJS dependency's client caught by your ESM code. `request`, `response` and `headers` are not enumerable, and `toJSON()` returns only name, message, description, status, method, a URL without query or userinfo, and `payload`. So `JSON.stringify(e)`, `console.error(e)` and error trackers never print your tokens.

`message` and `description` are kept apart on purpose. `message` is written by arthron — method, URL without query, status — so a log line or an error tracker says which request failed, and never carries text the server chose. `description` is the server's account of the failure: the right thing for a toast (`e.description ?? "Something went wrong"`), but untrusted — render it as text, never as HTML, and filter it if your gateway leaks internal routes in it.

Not every non-ok response is a failure. An opaque response (`mode: "no-cors"`) and the 3xx of `redirect: "manual"` come back as a `Response`, since you asked for them. `throwOn` picks which other non-ok responses reject, for the client or one call: `api.get("/maybe", { throwOn: (res) => res.status !== 404 })` returns the 404 to inspect. An ok response never rejects.

`.json(schema)` takes any [Standard Schema](https://standardschema.dev) — Zod, Valibot, ArkType and others — validates the body with it, and resolves with the schema's output (transforms included). A body that does not match rejects with a `SchemaError` whose `issues` list each problem and its path. It is not an `ArthronError`: the request worked, the data did not. arthron stays dependency-free; the schema library is yours.

A request that is aborted or times out rejects with the abort reason — `AbortError` / `TimeoutError`, or whatever you passed to `abort(reason)` — not an `ArthronError`.

### Derive clients

Clients are immutable. `use`, `extend` and `without` return a new client and leave the original alone — so keep what they return. `api.use(plugin)` on its own line does nothing.

```ts
const base = arthron({ baseURL: API, plugins: [logging(), retry()] });
const authed = base.use(bearerAuth({ origin: API, token })); // base + auth
const admin = authed.extend({ headers: { "x-role": "admin" } }); // authed + header
```

`extend` shallow-merges the config, merges headers case-insensitively (child wins), and adds plugins the way `use` does: a plugin whose `pluginName` is already there replaces it in place — so `streaming = base.use(timeout(120_000))` loosens the inherited `timeout`, and a second `retry()` does not multiply attempts — while other names append. Every plugin has a `pluginName`. `without("retry")` returns a client without that plugin. The built-ins are named `bearerAuth`, `logging`, `retry`, `timeout` and `uploadProgress`.

## Plugins

A plugin is an object with any of four slots:

```ts
type Plugin = {
  pluginName: string; // required — identity: use/extend replace the plugin of the same pluginName, without(pluginName) removes it. Not `name`: a function has one
  middleware?: (ctx: RequestContext, next: (ctx: RequestContext) => Promise<Response>) => Promise<Response>;
  requestInterceptor?: (ctx: RequestContext) => RequestContext | Promise<RequestContext>;
  responseInterceptor?: (res: Response, ctx: RequestContext) => Response | Promise<Response>;
  errorInterceptor?: (err: ArthronError, ctx: RequestContext) => ArthronError | Promise<ArthronError>;
};

type RequestContext = {
  url: string;
  init: Omit<RequestInit, "headers"> & { headers: Record<string, string> }; // lowercase names
  meta: ArthronMeta; // per-call plugin settings, never sent
  fetchFn?: typeof fetch; // the function this attempt is sent with (the client's fetchFn, else the global fetch) — replace it to send another way, wrap it to observe
};
```

How one request runs, with `plugins: [m1, m2]`:

```
call → m1 (before next) → m2 (before next) ─┐
                                             │  attempt — runs again each time a middleware calls next again
                                             │  request interceptors → fetch → response interceptors
                                             │                              ↘ error interceptors → throw
call ← m1 (after next)  ← m2 (after next)  ←─┘
```

A middleware is called once. `await next(ctx)` runs everything inside it and resumes the same call with the result — or the error, to `catch`. Request interceptors are not the outermost layer, as axios users may expect: they run inside every middleware, on every attempt. That is why a retry sends a refreshed token or a new trace id without extra code, and why a `timeout` also bounds a slow interceptor.

| | Middleware | Interceptor |
|---|---|---|
| Runs | Once per call, wrapping everything below | Once per attempt |
| Gets | `ctx` and `next` | A value: context, `Response`, or `ArthronError` |
| Can | Call `next` again (retry), skip it, add a deadline | Return a changed value |
| Cannot | — | Retry, skip, or stop the error from being thrown |
| Examples | `retry`, `timeout`, `logging`, auth refresh, error pages | auth header, tracing id, per-attempt error details |

Every attempt starts from a fresh copy of the context, so a header set by an interceptor on attempt one does not leak into attempt two. `ctx.init.headers` is always a plain record with lowercased names, restored to that shape after every request interceptor, so `{ ...ctx.init.headers, name: value }` is safe.

### Built in

The built-in plugins come from `arthron/plugins`: `import { bearerAuth, logging, retry, timeout, uploadProgress } from "arthron/plugins"`. They are plain plugins — anything they do, yours can.

| plugin | slots | per call |
|---|---|---|
| `bearerAuth` | request interceptor (the header) + middleware (refresh on 401) | `meta: { bearerAuth: false }` |
| `retry` | middleware | `meta: { retry: false \| options }` |
| `timeout` | middleware | `meta: { timeout: ms }` |
| `logging` | middleware | — |
| `uploadProgress` | request interceptor (swaps `ctx.fetchFn`) | `meta: { uploadProgress }` — only calls that pass it |

Order is meaning: the first plugin is outermost. A good default:

```ts
plugins: [logging(), bearerAuth(…), timeout(10_000), retry()]
```

`logging` first logs each call once — its start, and its end with the total time, retries included. A `timeout` before `retry` bounds the whole call; after it, each attempt — and a timed-out attempt is not retried. `bearerAuth` sets its header on every attempt wherever it sits. Anything that should see only the final outcome — an error page, mapping to domain errors — goes before `retry`.

Plugins with the same `pluginName` replace each other, so a second `timeout()` takes the first one's place instead of adding a deadline. For both a total and a per-attempt deadline, rename one:

```ts
plugins: [{ ...timeout(30_000), pluginName: "callTimeout" }, retry(), timeout(10_000)] // 30 s in all, 10 s per attempt
```

#### `retry(options)`

Re-runs the attempt on network failure or a retryable status. Because it re-runs the whole attempt, request interceptors run again — a refreshed token or a new trace id is picked up automatically.

| option | default | |
|---|---|---|
| `retries` | `2` | retries after the first attempt (3 requests total); a whole number ≥ 0 |
| `statuses` | `[408, 429, 500, 502, 503, 504]` | network failures (`status: 0`) are always retried |
| `methods` | `GET HEAD OPTIONS QUERY PUT DELETE` | case-insensitive |
| `delayFn` | `(retry) => Math.random() * 300 * 2 ** retry` | ms; `retry` counts from 0. Full jitter, so clients that failed together don't retry together |
| `maxRetryAfter` | `60_000` | a `Retry-After` longer than this means "don't retry" |
| `shouldRetry` | — | `(error, attempt, ctx) => boolean \| undefined`: `true` retries, `false` stops, `undefined` uses the rules above. Sees every error, an inner `TimeoutError` included |
| `onRetry` | — | `(error, attempt, waitMs) => void`, before each wait |

Honours `Retry-After` (seconds or HTTP date). Never retries a `ReadableStream` body or an aborted request, and never more than `retries` times — `shouldRetry` cannot lift those.

Opting a non-idempotent method in (`methods: ["POST"]`) means a network failure is retried too, and a dropped connection may already have reached the server. Where a duplicate would hurt — a payment, an LLM completion you pay for — keep retries to statuses: `shouldRetry: (e) => (isArthronError(e) && e.status === 0 ? false : undefined)`. Per call, `meta: { retry: false }` turns it off and `meta: { retry: { retries: 5 } }` overrides any option.

#### `timeout(ms)` / `timeout({ total?, idle? })`

Aborts the attempt after `ms`, counted until the body has been fully read — a server that sends headers and then stalls still trips it. Rejects with a `TimeoutError`, which `retry` and error interceptors ignore. Combines with a `signal` you pass yourself. `Infinity` means no deadline. The timer never keeps a Node process alive on its own. Per call, `meta: { timeout: 120_000 }` replaces the deadline (`Infinity` lifts it).

A total deadline also cuts off a stream that is still flowing. For streams, bound the silence instead: `timeout({ idle: 30_000 })` aborts only after 30 s without data — waiting for headers or between chunks — however long the stream runs. Both can be combined: `timeout({ total: 600_000, idle: 30_000 })`; `timeout(ms)` is `timeout({ total: ms })`. Options with neither are a `TypeError`.

```ts
arthron({ plugins: [retry(), timeout(5_000)] }); // 5 s per attempt — a timed-out attempt is not retried
arthron({ plugins: [timeout(5_000), retry()] }); // 5 s for all attempts together
```

#### `logging(options)`

```
[arthron] → GET https://api.example.com/users
[arthron] ← GET https://api.example.com/users 200 42ms
[arthron] ✕ GET https://api.example.com/users 503 1203ms
```

| option | default | |
|---|---|---|
| `enabled` | `true` | pass `process.env.NODE_ENV !== "production"` or similar — arthron never reads env |
| `logger` | `console` | anything with `log` and `error` |
| `onEvent` | — | receive `{ phase, method, path, status, ms, error }` instead of console lines |

Query strings and `user:pass@` are never printed. Cancellations are not logged.

#### `bearerAuth(options)`

Bearer tokens, with a refresh on 401.

```ts
const api = arthron({
  baseURL: API,
  plugins: [
    bearerAuth({
      origin: API,
      accessTokenFn: () => session.accessToken,
      refreshFn: async () => {
        const res = await api.post("/token/refresh", undefined, { meta: { bearerAuth: false } }).json<{ access_token: string }>();
        session.accessToken = res.access_token;
      },
    }),
  ],
});
```

| option | default | |
|---|---|---|
| `origin` | required | a URL or several; only their origins count, so `baseURL` works as is. Anything that is not an http(s) URL is a `TypeError` |
| `accessTokenFn` | required | `() => string \| null \| undefined`, or a promise of one; read on every attempt. No token, no header |
| `refreshFn` | — | `() => Promise<void>`, called after a 401; then the call is redone once. Without it, a 401 is thrown as is |

The token goes to `origin` only — never to a CDN or a URL taken from a response body. Concurrent 401s share one refresh: with refresh-token rotation, parallel refreshes would revoke each other and log the user out. A call whose token was already replaced by another call's refresh retries without refreshing again. A second 401 is thrown, and so is a failed refresh — every call waiting on it rejects with the error `refreshFn` threw, so that is the place to send the user to a login page. The 401 of a `ReadableStream` body is thrown without a refresh: the first try has read the stream, so there is nothing to resend.

Per call, `meta: { bearerAuth: false }` sends no token and never refreshes. Use it for the login and refresh endpoints: a refresh request that went through `bearerAuth()` would, on its own 401, wait for itself.

The token is treated as opaque: to refresh a JWT ahead of its `exp`, do it inside `accessTokenFn`. It is not for cookie sessions: it tells whether another call already refreshed by comparing the `authorization` header a call sent with the current one, and an httpOnly cookie cannot be read to compare.

#### `uploadProgress()`

Does nothing by itself — only a call that passes `meta.uploadProgress` reports progress. Every other call, on the same client too, goes out exactly as before.

```ts
const api = arthron({ baseURL: API, plugins: [retry(), uploadProgress()] }); // last in plugins

await api.get("/me"); // as usual
await api.post("/files", file, {
  meta: { uploadProgress: ({ loaded, total, progress }) => setBar(progress) }, // this call only
});
```

The event: `loaded` (bytes sent), `total` (bytes in the body, `undefined` when unknown — a stream without `content-length`), `progress` (`loaded / total` from 0 to 1, `undefined` with `total`). Progress counts what was handed to the network, so it reaches 1 a moment before the server has it all; the response arriving is the end. Each attempt counts from 0 again, so a retried upload starts the bar over.

How that call is sent depends on where it runs:

- **Browser:** over `XMLHttpRequest`, the only browser API that reports upload progress. On another origin, the upload listener makes every such call send a CORS preflight — an S3 bucket's CORS rules must allow the method and headers. The response arrives whole: `.sse()` / `.ndjson()` are not live on that call. What XHR cannot honour and would change the call is refused with a `TypeError` before sending: `redirect: "manual" | "error"`, `mode: "no-cors"`, and `credentials: "omit"` to the page's own origin (XHR always sends its cookies there). What only tunes fetch — `cache`, `priority`, `referrerPolicy`, `integrity`, `keepalive` — is ignored on that call. A `ReadableStream` body is sent as usual, without progress.
- **Node:** with `fetch` as usual, the body counted as it is read, in steps of at most 64 KiB. `content-length` and the content type a `Blob` would set are kept, so an S3 presigned `PUT` accepts it. A `FormData` body is encoded with its length known up front, its files streamed rather than read into memory. jsdom on Node counts the same way.
- **Anywhere else** — Deno, Bun, Cloudflare Workers, an Electron main process, a service worker — and on a client with its own `fetchFn`, or with another plugin's: sent as usual, without progress.

A callback that throws fails the call with its own error, untouched: not an `ArthronError`, not retried. Put `uploadProgress()` last in `plugins`: a request interceptor after it that replaces `init.signal` would cut that path, and the error would come back as a network failure.

### Write your own

`createPlugin` takes a plugin and returns it, typed without annotations and checked where you write it: a missing `pluginName`, an unknown key (a typo, or 1.x `name`), a slot that is not a function or a plugin with nothing to run is a `TypeError` that says what to write. `use` and `plugins` run the same check on plain objects. For a piece written on its own, `createMiddleware`, `createRequestInterceptor`, `createResponseInterceptor` and `createErrorInterceptor` type it the same way — `create` plus the type's name.

**`return await next(ctx)` inside `try`.** Without `await`, the promise is returned before it settles, and the `catch` never sees its error.

**Per attempt or per call.** A request interceptor runs on every attempt, so it fits a value that must be fresh each time: a token, a signature with a timestamp, a span id. A value that must be the same on every attempt — an idempotency key, so the server can tell a retry from a second payment — is set once, by a middleware placed before `retry()`:

```ts
const idempotent = createMiddleware((ctx, next) =>
  next({ ...ctx, init: { ...ctx.init, headers: { ...ctx.init.headers, "idempotency-key": crypto.randomUUID() } } }),
);
// A client of its own, so the order is exactly this: the key first, then retry.
const payments = arthron({ baseURL: API, plugins: [{ pluginName: "idempotency", middleware: idempotent }, retry({ methods: ["POST"] })] });
```

(`api.use(…)` would not do here if `api` already has a `retry()`: the new one takes the old one's place, which may be before the key.)

**Per-call settings.** `api.get(path, { meta })` hands `meta` to every plugin as `ctx.meta` and never sends it. Declare your own keys once and they are typed everywhere:

```ts
declare module "arthron" {
  interface ArthronMeta {
    skipTrace?: boolean;
  }
}

const traced = api.use({ pluginName: "trace", requestInterceptor: (ctx) => (ctx.meta.skipTrace ? ctx : withTraceId(ctx)) });
traced.get("/health", { meta: { skipTrace: true } });
```

**Refresh a session on 401, then redo the request.** That is the built-in [`bearerAuth()`](#bearerauthoptions), and a model for your own: the refresh is flow, so it is middleware; the header is a value, so it is a request interceptor — and because `next` re-runs the interceptors, the redone request carries the new token without extra code. Read [`src/plugins/bearer-auth/bearer-auth.ts`](src/plugins/bearer-auth/bearer-auth.ts) before writing a variant for another scheme.

**Send users to an error page.** This reacts to how the *call* ended, so it is middleware placed before `retry()`: it sees only the final result. An error interceptor would run on every failed attempt and navigate away even when the next retry succeeds. Error interceptors are for enriching the error of one attempt. Tested in [`examples/error-page.ts`](examples/error-page.ts).

```ts
import { createPlugin, isArthronError } from "arthron";

export const errorRedirect = (navigate: (to: string) => void) =>
  createPlugin({
    pluginName: "errorRedirect",
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

const api = arthron({ baseURL: API, plugins: [errorRedirect(router.push), retry()] }); // first: wraps retry
```

The same shape maps errors to your own types: `catch (e) { throw toDomainError(e); }` in an outermost middleware runs once per call, after retries.

**Attach a trace id.** A one-line request interceptor.

```ts
const traced = api.use({ pluginName: "trace", requestInterceptor: (ctx) => ({ ...ctx, init: { ...ctx.init, headers: { ...ctx.init.headers, "x-trace-id": crypto.randomUUID() } } }) });
```

## Reference

### `arthron(config)`

```ts
type ArthronClientOptions = {
  baseURL?: string;
  allowedOrigins?: string[]; // other origins absolute URLs may go to (only the origin of each URL counts; no config headers there)
  headers?: HeadersOption; // anything fetch's headers take, or a record whose null drops a header (in extend)
  fetchFn?: typeof fetch; // the function requests are sent with: a fake in tests, a polyfill, a framework's fetch; default the global fetch, read per request
  plugins?: Plugin[]; // outermost first; one with the pluginName of an earlier one replaces it
  extractDescription?: (payload: unknown, response: Response) => string | undefined; // extracts ArthronError.description from a failed response's payload
  throwOn?: (res: Response) => boolean; // which non-ok responses reject (also per call)
  // …plus any fetch option as a default: credentials, cache, redirect, mode,
  // keepalive, referrerPolicy, priority, integrity. Not body, method or signal —
  // those belong to one request (passing them throws).
};
```

### Client

```ts
get(path, init) · delete(path, init) · head(path, init)
post(path, body, init) · put(path, body, init) · patch(path, body, init)
query(path, body, init) // RFC 10008 QUERY
request(path, { method, body, ...init })
use(...plugins) → new client (same-name plugins replaced in place)
extend(config) → new client
without(...names) → new client without those plugins
```

All arguments after `path` are optional, except `method` in `request`. `request` is the way to any other verb; its `method` autocompletes the standard ones, and those go out uppercased whatever case you write them in (fetch itself leaves `"patch"` lowercase, which servers answer with 405). Other method names are sent as written.

The public object types — `ArthronClientOptions`, `RequestOptions`, `RequestContext`, `ArthronMeta`, `Plugin`, `ResponsePromise`, `ArthronClient` — are interfaces, so a plugin package can add its own options with `declare module "arthron" { interface RequestOptions { … } }`.

### `ArthronError`

```ts
class ArthronError extends Error {
  status: number; // 0 for network failures
  statusText: string;
  headers: Headers; // not enumerable
  payload: unknown; // the failed response's body, parsed (JSON, else text); undefined for a network failure
  description?: string; // the server's description of the failure, extracted from payload; untrusted text
  response?: Response; // absent for network failures; not enumerable
  request: RequestContext; // not enumerable — holds credentials
  cause?: unknown; // the underlying error for network failures
  toJSON(): { name; message; description; status; statusText; method; url; payload }; // url without query/userinfo
}
```

### Rules worth knowing

- **Fill path segments with `pathParams`.** `{name}` placeholders are encoded per segment; `""`, `.` and `..` are refused, as are missing or unused values. Without `pathParams`, braces are left alone.
- **URLs are joined by string concatenation.** `baseURL: "https://a/v1"` + `"/users"` → `https://a/v1/users`. The `/v1` survives, unlike with `new URL()`.
- **Absolute URLs stay on `baseURL`'s origin.** `api.get("https://other.example/x")` on a client with a `baseURL` rejects with a `TypeError`, because a path built from user input or an API response must not carry your credentials elsewhere. Same-origin absolute URLs work. List other origins in `allowedOrigins`; they get per-call headers only. To call any origin, use a client without `baseURL` or `allowedOrigins`. Only `http(s)` URLs are accepted.
- **Error bodies are read up to 64 KiB.** That is enough for any error message and keeps a huge or endless error body from filling memory. Past the limit `payload` is the raw text and the rest of the body is cancelled.
- **Redirects follow fetch's rules.** On a redirect to another origin, fetch drops `Authorization` but keeps other headers such as `x-api-key`. Pass `redirect: "error"` (or `"manual"`) for calls that carry such keys if the server could redirect off-origin.
- **Bodies.** `string`, `FormData`, `Blob`, `ArrayBuffer`/views, `URLSearchParams` and `ReadableStream` go through untouched — recognised by type tag, so polyfill and cross-realm instances count too. A `ReadableStream` is sent with `duplex: "half"`, which fetch requires. Anything else — including `null` — becomes JSON with `content-type: application/json`; a content type you set must be a JSON one. Bodies JSON would mangle — a `Map`, `Set`, generator, Node stream or function — are rejected with a `TypeError` that says what to pass instead. A `FormData` body is always sent without a `content-type` header, even with a JSON default, so the runtime can add the multipart boundary. `GET`/`HEAD` with a body is rejected with a `TypeError`.
- **Fetch defaults are flat and only sent when set.** Config takes the same fetch options per-call calls do (`credentials`, `cache`, `redirect`, …) as defaults; a per-call value wins and `extend` overrides. Nothing is sent that you did not set — cross-origin cookies need `credentials: "include"`. `signal`, `body` and `method` are per call: a client-wide signal would fail every call once aborted.
- **In browsers, CORS and the engine have the last word.** CI runs the built package in Chromium, Firefox and WebKit against a server on another origin. A JSON body, a custom header and `query()`'s QUERY method each make the browser send a preflight, so the API must allow them (`Access-Control-Allow-Methods: QUERY`, `Access-Control-Allow-Headers`). `retry()` reads `Retry-After` only if the API exposes it (`Access-Control-Expose-Headers: retry-after`); otherwise it waits its own delay. `redirect: "manual"` gives an opaque redirect (`status` 0, `type` `"opaqueredirect"`), returned rather than thrown. A `ReadableStream` body streams only over HTTP/2 (Chromium, WebKit), and the `ArthronError` for one sent to an HTTP/1.1 server says so. Where the browser cannot stream a request body at all (Firefox would send the text `"[object ReadableStream]"`), the call rejects with a `TypeError` before anything is sent. Either way, send a `Blob` or `ArrayBuffer` there.
- **Response bodies are single-use.** A response interceptor that wants to inspect the body must `res.clone()`; one that changes it returns a new `Response`.
- **Argument errors reject, they don't throw.** No `baseURL` with a relative path, a URL the global fetch cannot parse (`baseURL: "api.example.com"` without `https://`), a `BigInt` in a JSON body, a missing `method` in `request` — all surface as a rejected `TypeError` before anything is sent, never as a retried `status: 0`. A `fetchFn` you pass is the judge of its own URLs: arthron does not pre-check them, so one that accepts relative URLs (SvelteKit's server-side `fetch`) works with `baseURL: "/api"`.

## For tooling and agents

- `CHANGELOG.md` lists every release and the semver rules arthron follows since 1.0.
- `llms.txt` ships in the package — a compressed API reference meant to be read by LLM-based tools (`node_modules/arthron/llms.txt`).
- `examples/` holds type-checked, runnable recipes: LLM streaming, auth refresh, an error page, upload/download. `examples/recipes.test.ts` keeps the error-page recipe honest.
- Error messages state the fix (`… — pass baseURL in arthron({ baseURL }) or use an absolute URL`).

## Security

Report vulnerabilities privately through GitHub — see [SECURITY.md](SECURITY.md) for supported versions, response times and disclosure.

## License

MIT
