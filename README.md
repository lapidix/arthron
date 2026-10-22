<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo/arthron-lockup-dark.svg">
    <img alt="arthron" src=".github/assets/logo/arthron-lockup.svg" width="300">
  </picture>
</h1>

<p align="center">A lightweight <code>fetch</code> client you assemble from plugins.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/arthron"><img alt="npm version" src="https://img.shields.io/npm/v/arthron?color=14b8a6"></a>
  <a href="https://github.com/lapidix/arthron/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lapidix/arthron/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://bundlejs.com/?q=arthron"><img alt="minified and gzipped size" src="https://img.shields.io/bundlejs/size/arthron?color=14b8a6"></a>
  <a href="https://www.npmjs.com/package/arthron?activeTab=dependencies"><img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-14b8a6"></a>
  <a href="#quick-start"><img alt="Node 22 or later" src="https://img.shields.io/node/v/arthron?color=14b8a6"></a>
  <a href="#reference"><img alt="TypeScript types included" src="https://img.shields.io/npm/types/arthron?color=14b8a6"></a>
  <a href="https://github.com/lapidix/arthron/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/arthron?color=14b8a6"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#guide">Guide</a> ·
  <a href="#how-a-call-flows">How a call flows</a> ·
  <a href="#plugins">Plugins</a> ·
  <a href="#reference">Reference</a> ·
  <a href="https://github.com/lapidix/arthron/blob/main/CHANGELOG.md">Changelog</a>
</p>

## Quick start

```sh
npm i arthron
```

```ts
import { arthron, isArthronError } from "arthron";
import { logging, retry, timeout } from "arthron/plugins";

const api = arthron({
  baseURL: "https://api.example.com",
  plugins: [logging(), timeout(10_000), retry()], // 10 s for the whole call, retries included
});

async function getUser(id: string) {
  try {
    return await api.get("/users/{id}", { pathParams: { id } }).json<User>();
  } catch (e) {
    // ArthronError: a 4xx/5xx or a network failure. Cancellation and plugin bugs are not.
    if (isArthronError(e) && e.status === 404) return null;
    throw e;
  }
}
```

Coming from 1.x? Most old names throw a `TypeError` that names the new one; the full list is in [Moving from 1.x](CHANGELOG.md#moving-from-1x). Writing code with an AI agent? Point it at `llms.txt`, which ships in the package — see [For agents](#for-agents).

## Why arthron

- **Plain `Response` in, plain `Response` out.** No wrapper type to learn: `await api.get(…)` is the `Response` fetch gave, and `.json()`, `.sse()` and friends are there when you want the body.
- **Everything beyond fetch is a plugin.** Retry, timeouts, auth refresh, logging and upload progress are plugins built on the same API yours use. A plugin holds middleware, which controls the flow (retry, skip, deadlines), and interceptors, which transform one value; the types keep the two apart.
- **One error type, two causes.** `ArthronError` means the server said no (`!response.ok`) or the network failed (`status: 0`). Everything else — cancellation, a bug in a plugin — is rethrown as-is.
- **Safe by default.** Requests stay on `baseURL`'s origin unless you list others, and the client's headers never leave it. Path values cannot escape their segment. Errors never print your tokens or query strings. Error bodies and streams are read within limits.
- **Mistakes fail loudly.** A wrong option, a body JSON would mangle, a 1.x name: each is a `TypeError` that says what to write instead, before anything is sent.
- **Small and portable.** Zero dependencies. ESM and CJS. TypeScript 5.0+. Node 22+ and browsers — CI runs the built package in Chromium, Firefox and WebKit.

## Guide

### Requests

```ts
await api.get("/users", { queryParams: { page: 2 } }); // → Response
await api.post("/users", { name: "kim" }); // object body → JSON
await api.post("/upload", formData); // FormData/Blob/string/stream → sent as-is
await api.put("/users/1", { name: "lee" });
await api.patch("/users/1", { name: "lee" });
await api.query("/search", { filter: { tag: "x" } }); // RFC 10008 QUERY: GET semantics, body carries the query
await api.delete("/users/1");
await api.head("/users/1");
await api.request("/users", { method: "OPTIONS" }); // any other verb
```

**Request options.** The last argument, `requestOptions`, takes everything `fetch` does (`signal`, `cache`, `headers`, …) plus:

- `queryParams` — an object whose `null`/`undefined` values are dropped and whose arrays become repeated keys (`{ ids: [1, 2] }` → `ids=1&ids=2`), or a `URLSearchParams`. Other object values (a `Date`, a nested object) are rejected rather than sent as `[object Object]`.
- `pathParams` — values for `{name}` placeholders: `api.get("/users/{id}", { pathParams: { id } })`. Each is encoded into its own segment, so an id like `../admin` or `x?role=admin` cannot change which endpoint you call (`encodeURIComponent` alone lets `..` through); `""`, `.` and `..` are refused, as are missing or unused values. Use it instead of string interpolation. Without `pathParams`, braces are left alone.
- `meta` — settings for plugins on this call, never sent (see [Plugins](#plugins)).
- `throwOn` — which non-ok responses reject on this call (see [Errors](#errors)).

A `null` (or `undefined`) header value drops a client default for that call: `api.get("/public", { headers: { authorization: null } })`.

**URLs** are joined by string concatenation: `baseURL: "https://a/v1"` + `"/users"` → `https://a/v1/users`. The `/v1` survives, unlike with `new URL()`. A query is appended with `&` if the path already has one, and placed before any `#fragment`. Where absolute URLs may go is set on the client — see [Where requests and headers go](#where-requests-and-headers-go).

**Bodies.** `string`, `FormData`, `Blob`, `ArrayBuffer`/views, `URLSearchParams` and `ReadableStream` go through untouched — recognised by type tag, so polyfill and cross-realm instances count too. A `ReadableStream` is sent with `duplex: "half"`, which fetch requires. Anything else — including `null` — becomes JSON with `content-type: application/json`; a content type you set must be a JSON one. Bodies JSON would mangle — a `Map`, `Set`, generator, Node stream or function — are rejected with a `TypeError` that says what to pass instead. A `FormData` body is always sent without a `content-type` header, even with a JSON default, so the runtime can add the multipart boundary. `GET`/`HEAD` with a body is a `TypeError`.

**Methods.** `query` sends the [RFC 10008](https://www.rfc-editor.org/rfc/rfc10008) QUERY method: safe and idempotent like GET, so `retry()` repeats it by default, but the query travels in the body. Any `fetch` sends it; the server has to understand it (Node's own `http` server does from v20). `request` is the way to any other verb; its `method` autocompletes the standard ones, and those go out uppercased whatever case you write them in (fetch itself leaves `"patch"` lowercase, which servers answer with 405). Other method names are sent as written.

**Argument errors reject, they don't throw.** No `baseURL` with a relative path, a URL that does not parse (`baseURL: "api.example.com"` without `https://`), a `BigInt` in a JSON body, a missing `method` in `request` — all surface as a rejected `TypeError` before anything is sent, never as a retried `status: 0`.

### Responses

Each call returns `Promise<Response>` with body helpers attached:

```ts
const response = await api.get("/me"); // Response — status, headers, body untouched
const user = await api.get("/me").json<User>(); // body parsed; T is a cast, not validation
const safe = await api.get("/me").json(UserSchema); // validated by any Standard Schema (Zod, Valibot, ArkType); typed from it
const text = await api.get("/robots.txt").text();
const blob = await api.get("/export").blob();
const stream = (await api.post("/chat", prompt)).body; // ReadableStream
```

**Validating with a schema.** `.json(schema)` takes any [Standard Schema](https://standardschema.dev) — Zod, Valibot, ArkType and others, passed as is — validates the body with it, and resolves with the schema's output (transforms included). Its type is `ArthronSchema`: `StandardSchemaV1` from `@standard-schema/spec` under arthron's name, with `ArthronSchema.Infer<S>` for the output type and `ArthronSchema.Issue` for one problem. A body that does not match rejects with a `SchemaMismatchError` whose `issues` list each problem and its path. It is not an `ArthronError`: the request worked, the data did not. arthron stays dependency-free; the schema library is yours.

**Streams.**

```ts
// Server-sent events — one event per `for await` step
for await (const { type, data } of api.post("/v1/chat/completions", body).sse()) {
  if (data === "[DONE]") break; // provider sentinel; arthron does not interpret it
  process.stdout.write(JSON.parse(data).choices[0].delta.content ?? "");
}

// Newline-delimited JSON (Ollama, many log endpoints)
for await (const row of api.get("/logs").ndjson<LogRow>()) console.log(row);
```

`.sse()` parses `text/event-stream` the way the EventSource spec does: multi-line `data:` joined with `\n`, comments ignored, dispatch on a blank line, an event the stream ends inside dropped, `lastEventId` carried across events, `retry:` accepted as digits only and carried on as `reconnectionTime` (ms). Each event has the names a browser `MessageEvent` uses: `type` (the `event:` field, `"message"` when there is none), `data`, `lastEventId`, plus `id`. It does not reconnect — to resume, send `headers: { "last-event-id": e.lastEventId }` on a new request. Both helpers honour `signal` and `timeout` while the body is being read, and leaving the loop early (`break`, `return`, a throw) closes the connection.

A stream is untrusted input, so both helpers have limits: a line longer than `maxLineLength` (default 8 Mi characters), or an SSE event whose `data` outgrows `maxDataLength` (default 8 Mi characters), rejects the loop with a `RangeError` and closes the connection. Raise them per call if you expect bigger payloads: `.sse({ maxDataLength: 32 * 1024 * 1024 })`.

### Errors

```ts
import { isArthronError } from "arthron";

try {
  await api.get("/users/404");
} catch (e) {
  if (isArthronError(e)) {
    e.status; // 404, or 0 when the network failed
    e.payload; // the failed response's body, parsed: JSON, else text; undefined for a network failure
    e.description; // the server's description of the failure, or undefined — for people
    e.message; // arthron's own: "GET https://api.example.com/users/404 failed with 404 Not Found" — for logs
    e.response; // the failed Response, still readable (up to 64 KiB of its body)
    e.requestContext; // the RequestContext that was sent — url, init (method, headers), meta; read it directly, it is left out of logs
  }
}
```

**`message` is for logs, `description` is for people.** `message` is written by arthron — method, URL without query, status — so a log line or an error tracker says which request failed, and never carries text the server chose. `description` is the server's account of the failure: by default the payload's `message`, else `error` (a string), else `error.message`, else `detail`. It is the text to show a person (`e.description ?? "Something went wrong"`), but untrusted — render it as text, never as HTML, and filter it if your gateway leaks internal routes in it. For an API that puts it elsewhere, pass `extractDescription: (payload) => (payload as { msg?: string }).msg` to the client; one that throws on an unexpected body leaves `description` undefined and the error intact.

**Nothing leaks through an error.** `requestContext`, `response` and `headers` (the response's) are not enumerable, and `toJSON()` returns only name, message, description, status, statusText, method, a URL without query or userinfo, and `payload`. So `JSON.stringify(e)`, `console.error(e)` and error trackers never print your tokens. Error bodies are read up to 64 KiB — enough for any error message, and a huge or endless error body cannot fill memory; past the limit `payload` is the raw text and the rest of the body is cancelled. `isArthronError(e)` and `e instanceof ArthronError` work across copies of the package — the ESM and CJS builds loaded side by side, a CJS dependency's client caught by your ESM code.

**Not every non-ok response is a failure.** An opaque response (`mode: "no-cors"`) and the 3xx of `redirect: "manual"` come back as a `Response`, since you asked for them. `throwOn` picks which non-ok responses reject, for the client or one call (a call's wins): `api.get("/maybe", { throwOn: (response) => response.status !== 404 })` returns the 404 to inspect. A `throwOn` you pass replaces that default, so it decides for opaque responses and manual 3xx too — the one above rejects them. An ok response never rejects.

**Cancellation is not an `ArthronError`.** A request that is aborted or times out rejects with the abort reason — `AbortError` / `TimeoutError`, or whatever you passed to `abort(reason)`. So does a schema mismatch (`SchemaMismatchError`, above) and anything a plugin throws.

### Clients

```ts
const api = arthron({
  baseURL: "https://api.example.com", // prefix for relative paths
  headers: { accept: "application/json" }, // defaults; per-call headers win
  credentials: "include", // only if you need cookies cross-origin
  cache: "no-store", // any fetch option works as a default; per-call values win
  plugins: [retry()], // plugins, outermost first
});
```

Every field is optional. **Fetch defaults are flat and only sent when set:** the client takes the same fetch options a call does (`credentials`, `cache`, `redirect`, …) as defaults; a per-call value wins and `extend` overrides. Nothing is sent that you did not set — cross-origin cookies need `credentials: "include"`. `signal`, `body` and `method` belong to one call: a client-wide signal would fail every call once aborted, so passing them to the client throws.

#### Where requests and headers go

| The client has | Absolute URLs may go to | Its `headers` go to |
|---|---|---|
| `baseURL` | `baseURL`'s origin, and any in `allowedOrigins` | `baseURL`'s origin only — calls to a listed origin carry per-call headers alone |
| `allowedOrigins`, no `baseURL` | the listed origins only | nowhere: client headers are a `TypeError` here |
| neither | any `http(s)` URL | every origin — keep credentials out of them |

`api.get("https://other.example/x")` on a client with a `baseURL` rejects with a `TypeError`, because a path built from user input or an API response must not carry your credentials elsewhere. Same-origin absolute URLs work. `allowedOrigins: ["https://cdn.example.com"]` lists more; only the origin of each URL counts. Only `http(s)` URLs are accepted.

**Redirects follow fetch's rules.** On a redirect to another origin, fetch drops `Authorization` but keeps other headers such as `x-api-key`. Pass `redirect: "error"` (or `"manual"`) for calls that carry such keys if the server could redirect off-origin.

**`fetchFn`** is the function requests are sent with: a fake in tests, a polyfill, a framework's `fetch`. By default it is the global `fetch`, read per request, so a global patched later (msw) is still used. A `fetchFn` you pass is the judge of its own URLs: arthron does not pre-check them, so one that accepts relative URLs (SvelteKit's server-side `fetch`) works with `baseURL: "/api"`.

**Options are checked when the client is created.** An http(s) `baseURL` with no host (`"https://"` from an unset variable), client `headers` with `allowedOrigins` but no `baseURL`, an `allowedOrigins` entry that is not an http(s) URL, a `fetchFn` that is not a function, a 1.x option name — `arthron()` and `extend()` throw a `TypeError` right there, before any request.

#### Derive clients

Clients are immutable. `use`, `extend` and `without` return a new client and leave the original alone — so keep what they return. `api.use(plugin)` on its own line does nothing.

```ts
const base = arthron({ baseURL: API, plugins: [logging(), retry()] });
const authed = base.use(bearerAuth({ tokenOrigins: [API], accessTokenFn: () => token })); // base + auth
const admin = authed.extend({ headers: { "x-role": "admin" } }); // authed + header
```

`extend` shallow-merges the options, merges headers case-insensitively (child wins), and adds plugins the way `use` does: a plugin whose `pluginName` is already there replaces it in place — so `streaming = base.use(timeout(120_000))` loosens the inherited `timeout`, and a second `retry()` does not multiply attempts — while other names append. `without("retry")` returns a client without that plugin. The built-ins are named `bearerAuth`, `logging`, `retry`, `timeout` and `uploadProgress`.

### In browsers

CORS and the engine have the last word. CI runs the built package in Chromium, Firefox and WebKit against a server on another origin.

- A JSON body, a custom header and `query()`'s QUERY method each make the browser send a preflight, so the API must allow them (`Access-Control-Allow-Methods: QUERY`, `Access-Control-Allow-Headers`).
- `retry()` reads `Retry-After` only if the API exposes it (`Access-Control-Expose-Headers: retry-after`); otherwise it waits its own delay.
- `redirect: "manual"` gives an opaque redirect (`status` 0, `type` `"opaqueredirect"`), returned rather than thrown.
- A `ReadableStream` body streams only over HTTP/2 (Chromium, WebKit), and the `ArthronError` for one sent to an HTTP/1.1 server says so. Where the browser cannot stream a request body at all (Firefox would send the text `"[object ReadableStream]"`), the call rejects with a `TypeError` before anything is sent. Either way, send a `Blob` or `ArrayBuffer` there.

## How a call flows

```text
api.get(path, requestOptions)
  │  fill pathParams · join baseURL + path + queryParams
  │  check the origin (baseURL / allowedOrigins) · merge headers · serialize the body
  ▼
middleware[0] → middleware[1] → …                outermost first; the outermost once per call
  │  next(requestContext)                        a middleware may call it again (retry)
  ▼
attempt ─ request interceptors → fetchFn(url, init)
  ├─ ok, or let through by throwOn → response interceptors → Response
  ├─ !ok, or the network failed    → ArthronError → error interceptors → thrown
  └─ cancelled, or a plugin threw  → passed through untouched
  ▲
middleware resumes after `await next(…)`, last one first
  ▼
ResponsePromise ─ await → Response · .json() .text() .sse() .ndjson()
```

1. **Before the plugins.** The URL is built, its origin checked, the client's and the call's headers merged and the body serialized. A mistake here — no `baseURL`, a body JSON would mangle, an origin the client may not call — is a rejected `TypeError`, and no plugin runs.
2. **Middleware** wraps the whole call, outermost first. The outermost one runs once per call; one below a middleware that calls `next` again runs again each time (`[retry(), timeout(5_000)]` is 5 s per attempt). `await next(requestContext)` runs everything below it and resumes with the result, or the error to `catch`. A middleware may call `next` again — that is a retry — or not at all.
3. **An attempt** is one trip to the network: request interceptors, then `fetchFn`, then response or error interceptors. A retry runs the whole attempt again, so a refreshed token or a new trace id is picked up without extra code, and each attempt starts from a fresh copy of the context.
4. **Where errors come from.** Only a non-ok response (unless `throwOn` lets it through) and a failed `fetch` become an `ArthronError`, and only those reach error interceptors. Cancellation and exceptions thrown by plugins pass through untouched.
5. **What you get back.** The middleware unwinds, last one first, and the call resolves with the `Response` — untouched unless a response interceptor or a middleware returned a different one. The body helpers sit on top of that promise.

## Plugins

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
| Runs | Around everything below it: once per call, or again each time a middleware above it calls `next` again | Once per attempt |
| Gets | `requestContext` and `next` | A value: context, `Response`, or `ArthronError` |
| Can | Call `next` again (retry), skip it, add a deadline | Return a changed value |
| Cannot | — | Retry, skip, or stop the error from being thrown |
| Examples | `retry`, `timeout`, `logging`, auth refresh, error pages | auth header, tracing id, enriching one attempt's error |

Request interceptors are not the outermost layer, as axios users may expect: they run inside every middleware, on every attempt — which is also why a slow interceptor's time counts toward a `timeout`. The interceptor itself is cut off only if it listens to `requestContext.init.signal`; otherwise it runs to the end, and fetch then rejects with a `TimeoutError`. `requestContext.init.headers` is always a plain record with lowercased names, restored to that shape after every request interceptor, so `{ ...requestContext.init.headers, name: value }` is safe. Response bodies are single-use: a response interceptor that wants to inspect the body must `response.clone()`; one that changes it returns a new `Response`.

### Built in

The built-in plugins come from `arthron/plugins`: `import { bearerAuth, logging, retry, timeout, uploadProgress } from "arthron/plugins"`. So do their types: `BearerAuthOptions`, `LoggingOptions`, `LogEvent`, `RetryOptions`, `TimeoutOptions`, `UploadProgressEvent`. They are plain plugins — anything they do, yours can.

| plugin | what it does | slots | per call |
|---|---|---|---|
| [`retry`](#retryoptions) | repeats a failed attempt | middleware | `meta: { retry: false \| options }` |
| [`timeout`](#timeoutms--timeout-total-idle-) | aborts a slow or silent call | middleware | `meta: { timeout: false \| ms \| { total?, idle? } }` |
| [`logging`](#loggingoptions) | one line per call start and end | middleware | — |
| [`bearerAuth`](#bearerauthoptions) | sends a token, refreshes on 401 | request interceptor (the header) + middleware (the refresh) | `meta: { bearerAuth: false }` |
| [`uploadProgress`](#uploadprogress) | reports upload progress | request interceptor (swaps `requestContext.fetchFn`) | `meta: { uploadProgress: { onProgress } }` — only calls that pass it |

Order is meaning: the first plugin is outermost. A good default:

```ts
plugins: [logging(), bearerAuth(…), timeout(10_000), retry()]
```

`logging` first logs each call once — its start, and its end with the total time, retries included. A `timeout` before `retry` bounds the whole call; after it, each attempt — and by default a timed-out attempt is not retried. `bearerAuth` sets its header on every attempt wherever it sits. Anything that should see only the final outcome — an error page, mapping to domain errors — goes before `retry`.

Plugins with the same `pluginName` replace each other, so a second `timeout()` takes the first one's place instead of adding a deadline. For both a total and a per-attempt deadline, rename one:

```ts
plugins: [{ ...timeout(30_000), pluginName: "callTimeout" }, retry(), timeout(10_000)] // 30 s in all, 10 s per attempt
```

#### `retry(options)`

Re-runs the attempt on a network failure or a retryable status. Because it re-runs the whole attempt, request interceptors run again — a refreshed token or a new trace id is picked up automatically.

```ts
arthron({ baseURL: API, plugins: [retry({ retries: 3, statuses: [429, 503] })] });
```

| option | default | |
|---|---|---|
| `retries` | `2` | retries after the first attempt (3 requests total); a whole number ≥ 0 |
| `statuses` | `[408, 429, 500, 502, 503, 504]` | network failures (`status: 0`) are always retried |
| `methods` | `GET HEAD OPTIONS QUERY PUT DELETE` | case-insensitive |
| `delayFn` | `(attempt) => Math.random() * 300 * 2 ** attempt` | the wait in ms; `attempt` counts from 0 (0 after the first request failed), here as in `shouldRetry` and `onRetry`. Full jitter, so clients that failed together don't retry together. Must return a finite number ≥ 0, else the call rejects with a `TypeError` |
| `maxRetryAfter` | `60_000` | a `Retry-After` longer than this means "don't retry" |
| `shouldRetry` | — | `(error, attempt, requestContext) => boolean \| undefined`: `true` retries, `false` stops, `undefined` uses the rules above. Sees every error, an inner `TimeoutError` included |
| `onRetry` | — | `(error, attempt, delay) => void`, before each wait of `delay` ms |

**Per call:** `meta: { retry: false }` turns it off, and `meta: { retry: { retries: 5 } }` overrides any option.

Honours `Retry-After` (seconds or HTTP date). Never retries a `ReadableStream` body or an aborted request, never more than `retries` times, and never past a `Retry-After` longer than `maxRetryAfter` — `shouldRetry` cannot lift those. Opting a non-idempotent method in (`methods: ["POST"]`) means a network failure is retried too, and a dropped connection may already have reached the server. Where a duplicate would hurt — a payment, an LLM completion you pay for — keep retries to statuses: `shouldRetry: (error) => (isArthronError(error) && error.status === 0 ? false : undefined)`.

#### `timeout(ms)` / `timeout({ total?, idle? })`

Aborts a call that takes too long, or goes quiet for too long. Rejects with a `TimeoutError`, which error interceptors skip and `retry` does not repeat unless your `shouldRetry` returns `true` for it.

```ts
arthron({ plugins: [retry(), timeout(5_000)] }); // 5 s per attempt — by default a timed-out attempt is not retried
arthron({ plugins: [timeout(5_000), retry()] }); // 5 s for all attempts together
arthron({ plugins: [timeout({ idle: 30_000 })] }); // for streams: 30 s without data
```

| option | default | |
|---|---|---|
| `total` | none | ms from the start of the attempt until the body has been fully read — a server that sends headers and then stalls still trips it. `timeout(ms)` is `timeout({ total: ms })` |
| `idle` | none | ms without data — while waiting for the headers and between chunks. A stream that keeps flowing is never cut off |

**Per call:** `meta: { timeout: false }` lifts the deadlines, `meta: { timeout: 120_000 }` replaces the total one, and `meta: { timeout: { idle: 60_000 } }` replaces the parts it sets — the same shape as `meta.retry`.

A total deadline also cuts off a stream that is still flowing; for streams, bound the silence with `idle` instead, or combine both: `timeout({ total: 600_000, idle: 30_000 })`, whichever trips first. Options with neither are a `TypeError`. `Infinity` means no deadline. It combines with a `signal` you pass yourself, and its timer never keeps a Node process alive on its own.

#### `logging(options)`

One line when a call starts and one when it ends, with the status and the total time, retries included.

```
[arthron] → GET https://api.example.com/users
[arthron] ← GET https://api.example.com/users 200 42ms
[arthron] ✕ GET https://api.example.com/users 503 1203ms
```

| option | default | |
|---|---|---|
| `enabled` | `true` | pass `process.env.NODE_ENV !== "production"` or similar — arthron never reads env |
| `logger` | `console` | anything with `log` and `error` |
| `onEvent` | — | receive `{ phase, method, url, status, duration, error }` instead of console lines: `url` without query or userinfo, `duration` in ms |

**Per call:** —. Query strings and `user:pass@` are never printed. Cancellations are not logged.

#### `bearerAuth(options)`

Bearer tokens, with a refresh on 401.

```ts
const api = arthron({
  baseURL: API,
  plugins: [
    bearerAuth({
      tokenOrigins: [API],
      accessTokenFn: () => session.accessToken,
      refreshFn: async () => {
        const tokens = await api
          .post("/token/refresh", undefined, { meta: { bearerAuth: false } })
          .json<{ access_token: string }>();
        session.accessToken = tokens.access_token;
      },
    }),
  ],
});
```

| option | default | |
|---|---|---|
| `tokenOrigins` | required | a list of URLs; only their origins count, so `[baseURL]` works as is. Requests from a relative `baseURL` (`"/api"`) go to the page's origin: list that origin (`"https://app.example.com"`), since `"/api"` itself is not an http(s) URL. An entry that is not an http(s) URL, an empty list or one string instead of a list is a `TypeError` |
| `accessTokenFn` | required | `() => string \| null \| undefined`, or a promise of one; read on every attempt. No token, no header |
| `refreshFn` | — | `() => Promise<void>`, called after a 401 to refresh the session, so the next `accessTokenFn()` returns the new token; then the call is redone once. Without it, a 401 is thrown as is |

**Per call:** `meta: { bearerAuth: false }` sends no token and never refreshes. Use it for the login and refresh endpoints. A request `refreshFn` starts through the same client before its first `await` is sent that way on its own; one it starts after an `await` needs the meta, or its 401 would wait for the refresh it is part of.

The token goes to `tokenOrigins` only — never to a CDN or a URL taken from a response body. Concurrent 401s share one refresh: with refresh-token rotation, parallel refreshes would revoke each other and log the user out. A call whose token was already replaced by another call's refresh retries without refreshing again. A second 401 is thrown, and so is a failed refresh — every call waiting on it rejects with the error `refreshFn` threw, so that is the place to send the user to a login page. The 401 of a `ReadableStream` body is thrown without a refresh: the first try has read the stream, so there is nothing to resend.

The token is treated as opaque: to refresh a JWT ahead of its `exp`, do it inside `accessTokenFn`. It is not for cookie sessions: it tells whether another call already refreshed by comparing the `authorization` header a call sent with the current one, and an httpOnly cookie cannot be read to compare.

#### `uploadProgress()`

Reports how much of a call's body has been sent. It does nothing by itself — only a call that passes `meta.uploadProgress` reports progress, and every other call, on the same client too, goes out exactly as before.

```ts
const api = arthron({ baseURL: API, plugins: [retry(), uploadProgress()] }); // last in plugins

await api.get("/me"); // as usual
await api.post("/files", file, {
  meta: { uploadProgress: { onProgress: ({ fraction }) => setBar(fraction) } }, // this call only
});
```

| event field | |
|---|---|
| `loaded` | bytes sent |
| `total` | bytes in the body; `undefined` when unknown — a stream without `content-length` |
| `fraction` | `loaded / total`, from 0 to 1 — not a percentage; `undefined` with `total` |

**Per call:** `meta: { uploadProgress: { onProgress } }`, only on calls that want progress. Progress counts what was handed to the network, so it reaches 1 a moment before the server has it all; the response arriving is the end. Each attempt counts from 0 again, so a retried upload starts the bar over.

How that call is sent depends on where it runs:

- **Browser:** over `XMLHttpRequest`, the only browser API that reports upload progress. On another origin, the upload listener makes every such call send a CORS preflight — an S3 bucket's CORS rules must allow the method and headers. The response arrives whole: `.sse()` / `.ndjson()` are not live on that call. What XHR cannot honour and would change the call is refused with a `TypeError` before sending: `redirect: "manual" | "error"`, `mode: "no-cors"`, `credentials: "omit"` to the page's own origin (XHR always sends its cookies there), a `referrerPolicy` or `referrer` of its own (XHR sends the page's referrer) and `integrity` (XHR cannot check it). What only tunes fetch — `cache`, `priority`, `keepalive` — is ignored on that call. A `ReadableStream` body is sent as usual, without progress.
- **Node:** with `fetch` as usual, the body counted as it is read, in steps of at most 64 KiB. `content-length` and the content type a `Blob` would set are kept, so an S3 presigned `PUT` accepts it. A `FormData` body is encoded with its length known up front, its files streamed rather than read into memory. jsdom on Node counts the same way.
- **Anywhere else** — Deno, Bun, Cloudflare Workers, an Electron main process, a service worker — and on a client with its own `fetchFn`, or with another plugin's: sent as usual, without progress.

An `onProgress` that throws fails the call with its own error, untouched: not an `ArthronError`, not retried. Put `uploadProgress()` last in `plugins`: a request interceptor after it that replaces `init.signal` would cut that path, and the error would come back as a network failure.

### Write your own

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

#### Recipes

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

**Send users to an error page.** This reacts to how the *call* ended, so it is middleware placed before `retry()`: it sees only the final result. An error interceptor would run on every failed attempt and navigate away even when the next retry succeeds. Error interceptors are for enriching the error of one attempt. Tested in [`examples/error-page.ts`](examples/error-page.ts).

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

**Refresh a session on 401, then redo the request.** That is the built-in [`bearerAuth()`](#bearerauthoptions), and a model for your own: the refresh is flow, so it is middleware; the header is a value, so it is a request interceptor — and because `next` re-runs the interceptors, the redone request carries the new token without extra code. Read [`src/plugins/bearer-auth/bearer-auth.ts`](src/plugins/bearer-auth/bearer-auth.ts) before writing a variant for another scheme.

## Reference

### `arthron(clientOptions)`

```ts
type ArthronClientOptions = {
  baseURL?: string;
  allowedOrigins?: readonly string[]; // other origins absolute URLs may go to (only the origin of each URL counts); calls there get per-call headers only. Without baseURL it alone limits absolute URLs, and client headers are refused
  headers?: HeadersInit | Record<string, string | null | undefined>; // sent to baseURL's origin only; a null value drops a header (in extend)
  fetchFn?: typeof fetch; // the function requests are sent with: a fake in tests, a polyfill, a framework's fetch; default the global fetch, read per request
  plugins?: readonly Plugin[]; // outermost first; one with the pluginName of an earlier one replaces it
  extractDescription?: (payload: unknown, response: Response) => string | undefined; // extracts ArthronError.description from a failed response's payload; one that throws leaves it undefined
  throwOn?: (response: Response) => boolean; // which non-ok responses reject (also per call)
  // …plus any fetch option as a default: credentials, cache, redirect, mode,
  // keepalive, referrerPolicy, priority, integrity. Not body, method or signal —
  // those belong to one request (passing them throws).
};
```

### Client

```ts
get(path, requestOptions) · delete(path, requestOptions) · head(path, requestOptions)
post(path, body, requestOptions) · put(path, body, requestOptions) · patch(path, body, requestOptions)
query(path, body, requestOptions) // RFC 10008 QUERY
request(path, { method, body, ...requestOptions })
use(...plugins) → new client (a plugin with the same pluginName is replaced in place)
extend(clientOptions) → new client
without(...pluginNames) → new client without those plugins
```

All arguments after `path` are optional, except `method` in `request`. Every request method returns a `ResponsePromise`: a `Promise<Response>` with `.json()`, `.text()`, `.blob()`, `.arrayBuffer()`, `.formData()`, `.sse()` and `.ndjson()`.

### `ArthronError`

```ts
class ArthronError extends Error {
  constructor(options: ArthronErrorOptions); // the fields below, for a test or a plugin that builds one
  status: number; // 0 for network failures
  statusText: string;
  headers: Headers; // the response's headers; not enumerable
  payload: unknown; // the failed response's body, parsed (JSON, else text); undefined for a network failure
  description: string | undefined; // the server's description of the failure, extracted from payload; untrusted text
  response?: Response; // absent for network failures; not enumerable
  requestContext: RequestContext; // what plugins get as requestContext, as sent (url, init.method, init.headers, meta) — not a fetch Request; not enumerable, holds credentials
  cause?: unknown; // the underlying error for network failures (query and userinfo redacted)
  toJSON(): { name; message; description; status; statusText; method; url; payload }; // url without query/userinfo
}
```

### Types

From `arthron`: `ArthronClient`, `ArthronClientOptions`, `RequestOptions`, `RequestOptionsWithMethod`, `HttpMethod`, `QueryParams`, `RequestContext`, `ArthronMeta`, `Plugin`, `Middleware`, `RequestInterceptor`, `ResponseInterceptor`, `ErrorInterceptor`, `ResponsePromise`, `SseEvent`, `SseOptions`, `NdjsonOptions`, `ArthronSchema` (with `.Infer`, `.Issue`, `.ValidationResult`), `DescriptionExtractor`, `ArthronErrorOptions`. From `arthron/plugins`: the built-ins' option and event types listed under [Built in](#built-in).

The public object types — `ArthronClientOptions`, `RequestOptions`, `RequestOptionsWithMethod`, `RequestContext`, `ArthronMeta`, `Plugin`, `ResponsePromise`, `ArthronClient`, `ArthronSchema` — are interfaces, so a plugin package can add its own options with `declare module "arthron" { interface RequestOptions { … } }`.

## For agents

- **`llms.txt`** ships in the package (`node_modules/arthron/llms.txt`): the whole API in one compressed file, meant to be read by LLM-based tools — including a line that maps every 1.x name to its 2.0 one.
- **Error messages state the fix** (`… — pass baseURL in arthron({ baseURL }) or use an absolute URL`), and most 1.x names throw a `TypeError` naming the new one, so an agent working from an old example is told what to change.
- **`examples/`** holds type-checked, runnable recipes: LLM streaming, auth refresh, an error page, upload/download. `examples/recipes.test.ts` keeps the error-page recipe honest.
- **`CHANGELOG.md`** lists every release, the semver rules arthron follows since 1.0, and [Moving from 1.x](CHANGELOG.md#moving-from-1x).

## Security

Report vulnerabilities privately through GitHub — see [SECURITY.md](SECURITY.md) for supported versions, response times and disclosure.

## License

MIT
