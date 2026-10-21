# Changelog

All notable changes to arthron. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

From 1.0.0 arthron follows [Semantic Versioning](https://semver.org/):

- **Major** — removing or changing anything exported from `arthron` or `arthron/plugins` (values or types), changing a default behaviour, or raising the minimum supported Node.js or TypeScript version.
- **Minor** — new exports, options or behaviour that is off unless you opt in, and deprecations.
- **Patch** — fixes that keep documented behaviour.

A minor deprecates rather than removes: the old API keeps working, marked `@deprecated` with what to use instead, until the next major. A major may also rename or remove without a deprecation first; its entry then says how to move over, and an old option name that would otherwise be ignored throws a `TypeError` naming its replacement.

## [Unreleased]

Removes what 1.1.0 deprecated and renames what read as something else, so each name says what it holds: each plugin has one import path, `timeout()` one way to take `idle`, every built-in plugin with a per-call setting reads the `meta` key named after it, the function requests are sent with has one name, a failed response's account is a `description` apart from arthron's `message`, and a client names the origins it may call. Moving from 1.x means changing imports and names; most 1.x names that would otherwise be ignored throw a `TypeError` naming their replacement, and the rest are type errors (see the last Breaking bullet).

### Breaking

- `logging`, `retry` and `timeout`, and the `LogEvent`, `LoggingOptions` and `TimeoutOptions` types, are no longer exported from `arthron` — import them from `arthron/plugins`, where they have been since 1.1.0. So is `RetryOptions`, which 1.1.0 had left on the main entry without a deprecation.
- `timeout(ms, { idle })` is gone — write `timeout({ total: ms, idle })`. An object second argument is a `TypeError` that names the replacement.
- `meta.onUploadProgress` is now `meta.uploadProgress: { onProgress }`. Plugin X's per-call setting is `meta.X`, like `meta.bearerAuth`, `meta.retry` and `meta.timeout`, and a callback is `on…`: the setting is an object holding the callback, as `meta.retry` holds options. A bare function there is a `TypeError` naming this form. Its event's `progress` is `fraction`: the value is `loaded / total` from 0 to 1, and `progress` (axios's name) said nothing of the scale — code that fed it to a percentage bar stalled at 1%.
- The `fetch` option is now `fetchFn`, and `RequestContext.fetch` is `RequestContext.fetchFn` — one name for the function requests are sent with: the client's, and each attempt's, which a plugin may replace (`uploadProgress()` sends over XMLHttpRequest) or wrap. As `fetch`, it read like the global function.
- `ArthronError.detail` is now `description` and `ArthronError.data` is `payload`, in `toJSON()` too. Both exist only for a failed response: `description` is the server's account of the failure, for people, apart from `message`, which arthron writes for logs; `payload` is that response's parsed body, apart from `response.body`, the stream. The `errorDetail` option is `extractDescription: (payload, response) => string | undefined`, and its type `DescriptionExtractor` (was `ErrorDetailResolver`).
- `ArthronError.request` is `requestContext`: it holds the `RequestContext` plugins get as `requestContext`, not a fetch `Request` — next to `e.response`, a real `Response`, `e.request.headers` read naturally and was `undefined`. The method and headers are at `requestContext.init.method` and `.init.headers`. The constructor takes `ArthronErrorOptions`, now exported, with `payload`, `description` and `requestContext` (were `data`, `detail` and `request`).
- The `use` option is now `plugins`: it holds a list of plugins. `api.use()` keeps its name: it is an action.
- Per call, `params` is now `queryParams` and `path` is `pathParams`: the first argument is already the path, and the two say which part of the URL they fill.
- A plugin's `request`, `response` and `error` interceptors are `requestInterceptor`, `responseInterceptor` and `errorInterceptor`: each slot is named after the type it holds, and none shares a word with `api.request()`.
- `definePlugin`, `defineMiddleware` and `defineInterceptor` are gone. `createPlugin`, `createMiddleware`, `createRequestInterceptor`, `createResponseInterceptor` and `createErrorInterceptor` take their place — `create` plus the type's name — and type what they are given without annotations.
- A plugin's `name` is now `pluginName`, and required: every plugin can be replaced by its `pluginName` and removed with `without()`. Not `name`, because a function has one: with `name`, a bare middleware passed to `use` type-checked as a plugin; with `pluginName` it is a type error. `createPlugin` checks a plugin where it is written, and `use` and `plugins` check whatever they are given the same way: no `pluginName`, an unknown key (a typo — state goes in a closure, in a function that returns `createPlugin({ … })`), a slot that is not a function, nothing to run, or a bare function is a `TypeError` that says what to write. Only a plugin's own fields count as 1.x names, so a helper method named `error` on a prototype is not one.
- The options that hold a function are named for what it does. `bearerAuth({ token, refresh })` is `bearerAuth({ accessTokenFn, refreshFn })`, and `retry({ delay })` is `retry({ delayFn })`: the function produces the value named, with `Fn`. `extractDescription` takes the description out of a payload, so it is named for that action. Event callbacks (`onRetry`, `onEvent`) and yes/no decisions (`shouldRetry`, `throwOn`) keep their names.
- `bearerAuth({ origin })` is `bearerAuth({ tokenOrigins })`, a list only: the origins the token may go to, named apart from the client's `allowedOrigins` (where a request may go). A singular name held one URL or a list; one string is now a `TypeError` naming the list form.
- `retry({ retryOn })` is `retry({ statuses })`, beside `methods`: named like `throwOn`, which takes a function, it held a list. `delayFn`'s counter is `attempt`, as in `shouldRetry` and `onRetry`, all 0-based, and `onRetry`'s last argument is `delay`, the value `delayFn` returned (was `waitMs`); positional, so no code changes. `delayFn` must return a finite number ≥ 0: a 1.x `delay` moved over with its arguments swapped would return `NaN` and retry in a tight loop, so that is a `TypeError` now.
- `retry`'s `sleep` and `logging`'s `now` leave the public options: both were hooks for tests. Use fake timers or a spy on `performance.now` in yours.
- `LogEvent.path` is `url` — it holds the URL with its origin, minus query and userinfo, what `toJSON()` calls `url` — and `LogEvent.ms` is `duration`. Times are in ms throughout arthron.
- Server-sent events use the names a browser `MessageEvent` uses: `event` is `type`, and is `"message"` when the server sent no `event:` line, as in a browser (was `undefined`). `retry` is `reconnectionTime`, the spec's name for it, apart from the `retry` plugin. `.sse({ maxEventSize })` is `.sse({ maxDataLength })`: it limits an event's `data` in characters, like `maxLineLength`, not bytes as "size" suggested.
- The schema types are under one name: `StandardSchemaV1` is `ArthronSchema` (the same interface from `@standard-schema/spec`, under arthron's name and without the spec's version), `InferOutput<S>` is `ArthronSchema.Infer<S>` (valibot exports an `InferOutput` too), and `SchemaIssue` is `ArthronSchema.Issue`. `SchemaError` is `SchemaMismatchError`: the body does not match the schema; the schema is fine. A Zod, Valibot or ArkType schema still goes in as is.
- The types are named after what they are: `Arthron` is `ArthronClient`, `ArthronConfig` is `ArthronClientOptions`, `ArthronPromise` is `ResponsePromise`, and `RequestInitWithBody` is `RequestOptionsWithMethod`. `HeadersOption` is gone: `headers` in the client and request options is written out as fetch's `headers` or a record whose `null` drops one — `Option` among the `…Options` types read as a bag of settings. Parameters follow their types: `arthron(clientOptions)`, `extend(clientOptions)`, `get(path, requestOptions)`; `init` now means fetch's `RequestInit` only. One value has one name: the interceptors, `middleware`, `shouldRetry` and `throwOn` take `requestContext`, `response` and `error` (were `ctx`, `res`, `err`), the names `ArthronError.requestContext`, `e.response` and `LogEvent.error` use — error messages too. Parameter names change only what hovers show.
- `allowAbsoluteUrls` is replaced by `allowedOrigins`, a list: with a `baseURL`, an absolute URL may go to `baseURL`'s origin or a listed one, and any other origin is a `TypeError`. Only the origin of each entry counts; an empty list, a non-http(s) entry or a single string is a `TypeError` when the client is created. Without a `baseURL`, the list alone limits absolute URLs. With a `baseURL`, config `headers` still go to its origin only, never to a listed one; without one, config `headers` with `allowedOrigins` are a `TypeError`, since they would have nowhere to go. To reach any origin, as `allowAbsoluteUrls: true` did, use a separate client without `baseURL` or `allowedOrigins` — and keep credentials out of its config `headers`, which such a client sends to every origin.
- A client's options are checked when it is created: an http(s) `baseURL` with no host (`"https://"` from an unset variable, which let a relative path choose the host) and a `fetchFn` that is not a function are `TypeError`s there.
- A 1.x name is a `TypeError` that names its replacement: the options `fetch`, `use`, `errorDetail` and `allowAbsoluteUrls`; `params` and `path` per call; a plugin's `name`, `request`, `response` and `error`; a context's `fetch` set by a request interceptor or passed to `next`; `bearerAuth`'s `token`, `refresh` and `origin`; `retry`'s `delay`, `retryOn` and `sleep`, in `meta.retry` too; `logging`'s `now`; `meta.onUploadProgress` with `uploadProgress()`. Left alone, each would be an unknown key and ignored: plugins or interceptors not applied, a test's fake fetch passed over for the network, `{id}` sent unfilled, the query left off, no token sent. Renamed fields and types — `e.detail`, `e.data`, `e.request`, an SSE event's `event` and `retry`, the progress event's `progress`, `LogEvent`'s `path` and `ms`, the types above — are caught by TypeScript; from JavaScript they read as `undefined`.
- `uploadProgress()` refuses, over XMLHttpRequest, a call with its own `referrerPolicy`, `referrer` or `integrity`, as it refuses `redirect: "manual"`: XHR sends the page's referrer under the page's policy and checks no integrity, so a call with `referrerPolicy: "no-referrer"` sent the page's URL as `Referer`. The defaults (`""`, `"about:client"`) still go over XHR. `cache`, `priority` and `keepalive` are still ignored there.

### Added

- `meta.timeout` takes `false` and an object, like `meta.retry`: `false` lifts both deadlines for the call, `{ idle: 30_000 }` or `{ total }` replaces the parts it sets and keeps the others. A number still replaces `total`.
- `ArthronErrorOptions`, the type `new ArthronError()` takes, for tests and plugins that build an error.

### Fixed

- A failed response whose `extractDescription` throws — an extractor written for the API's JSON, handed a gateway's HTML page — is still an `ArthronError`, with no `description`. It was a raw `TypeError`: no status, not retried, error interceptors skipped.
- A plugin that sets `requestContext.fetchFn` to something that is not a function gets a `TypeError`, not a network `ArthronError` with status 0 that `retry` repeated.
- `allowedOrigins` is copied when the client is created: pushing to the array afterwards no longer widens a client derived with `use` or `extend`.
- Messages: a refused `allowedOrigins` entry or a relative `baseURL` is shown without its query and userinfo; an absolute URL that does not parse says so, instead of "undefined is outside baseURL"; a 1.x option in `meta.retry` points to `meta: { retry: { … } }`; a `pathParams` value that would change the path names `pathParams.id`; `request()` without a method says it needs one.
- `[5000, 10_000].map(timeout)` works: the guard for the 1.x `timeout(ms, { idle })` mistook `map`'s index for it.
- `plugins` takes a readonly list: `plugins: [retry(), timeout(1000)] as const` was a type error.
- `timeout()` no longer keeps each response alive as long as the caller's signal. A call with a `signal` (an app-wide or shutdown controller passed to every call) left an abort listener on the signal joined to it, which kept that signal and the body's reader from being collected.
- `bearerAuth()` with a `refreshFn` no longer hangs when the refresh request goes through the same client and gets a 401. A request `refreshFn` starts before its first `await` goes out as with `meta: { bearerAuth: false }` — no stale token, no refresh — and its 401 rejects the refresh, and with it every waiting call. One started after an `await` still needs that meta.
- `bearerAuth()` sends the token on a client with a relative `baseURL` (`"/api"`) in a browser: such a URL is on the page's origin. Before, no URL without an origin of its own got the token.
- The runtime's error that a network `ArthronError` — or the `TypeError` for a malformed URL — carries as `cause` has the URL's query and userinfo taken out of its message, stack, string fields (Node's `input`) and own causes. `console.error` and error trackers print that chain, so `?token=…` reached logs although `message` and `toJSON()` left it out. It is the same error object, `code` included.
- A `FormData` or `URLSearchParams` body from a polyfill (formdata-node) or another realm is copied for each attempt, like a global one: an interceptor's `append` on a retried call no longer piles up.

### Changed

- A call sent with the runtime's fetch no longer builds a throwaway `Request` to check its URL and method first; the check runs only once fetch has failed, with the same `TypeError`. A client sorts its plugins into middleware and interceptors once, when it is created, not on every request.
- The package is half the size to install: no sourcemaps (`dist` is not minified and reads as is), and the code both entries share is `dist/shared.*` rather than a hashed file named after one module in it. Bundles are unchanged.

### Moving from 1.x

```diff
-import { arthron, retry, timeout, type RetryOptions } from "arthron";
+import { arthron } from "arthron";
+import { retry, timeout, type RetryOptions } from "arthron/plugins";

-timeout(60_000, { idle: 30_000 })
+timeout({ total: 60_000, idle: 30_000 })
-timeout(Infinity, { idle: 30_000 })
+timeout({ idle: 30_000 })

-api.post("/upload", file, { meta: { onUploadProgress: (e) => setBar(e.progress) } })
+api.post("/upload", file, { meta: { uploadProgress: { onProgress: (e) => setBar(e.fraction) } } })

-arthron({ baseURL: API, fetch: fakeFetch })
+arthron({ baseURL: API, fetchFn: fakeFetch })
-request: (ctx) => ({ ...ctx, fetch: traced(ctx.fetch) })
+requestInterceptor: (requestContext) => ({ ...requestContext, fetchFn: traced(requestContext.fetchFn) })

-arthron({ baseURL: API, use: [retry()], errorDetail: (data) => data.msg })
+arthron({ baseURL: API, plugins: [retry()], extractDescription: (payload) => (payload as { msg?: string }).msg })
-toast(e.detail ?? "Something went wrong"); log(e.data, e.request.url)
+toast(e.description ?? "Something went wrong"); log(e.payload, e.requestContext.url)
-new ArthronError({ message, status, statusText, headers, data, detail, request })
+new ArthronError({ message, status, statusText, headers, payload, description, requestContext })

-api.get("/users/{id}", { path: { id }, params: { page: 2 } })
+api.get("/users/{id}", { pathParams: { id }, queryParams: { page: 2 } })

-{ name: "trace", request: addTraceId, response: logIt, error: wrapIt }
+{ pluginName: "trace", requestInterceptor: addTraceId, responseInterceptor: logIt, errorInterceptor: wrapIt }
-definePlugin({ request: addTraceId })
+createPlugin({ pluginName: "trace", requestInterceptor: addTraceId })
-defineMiddleware(fn)
+createMiddleware(fn)
-defineInterceptor.request(f) / .response(f) / .error(f)
+createRequestInterceptor(f) / createResponseInterceptor(f) / createErrorInterceptor(f)

-bearerAuth({ origin: API, token: () => tok, refresh })
+bearerAuth({ tokenOrigins: [API], accessTokenFn: () => tok, refreshFn: refresh })
-retry({ retryOn: [503], delay: (n) => 1000 * n })
+retry({ statuses: [503], delayFn: (attempt) => 1000 * attempt })
-logging({ onEvent: (e) => metrics(e.path, e.ms) })
+logging({ onEvent: (e) => metrics(e.url, e.phase === "start" ? 0 : e.duration) })

-for await (const { event, data } of api.get("/stream").sse({ maxEventSize: n })) if (event === "update") …
+for await (const { type, data } of api.get("/stream").sse({ maxDataLength: n })) if (type === "update") …
-event.retry
+event.reconnectionTime

-const user = await api.get("/me").json(schema) as InferOutput<typeof schema>
+const user: ArthronSchema.Infer<typeof schema> = await api.get("/me").json(schema)
-if (e instanceof SchemaError) e.issues as SchemaIssue[]
+if (e instanceof SchemaMismatchError) e.issues as ArthronSchema.Issue[]
-function check(schema: StandardSchemaV1) {}
+function check(schema: ArthronSchema) {}

-function makeRepo(api: Arthron, options: ArthronConfig): ArthronPromise {}
+function makeRepo(api: ArthronClient, options: ArthronClientOptions): ResponsePromise {}
-const call: RequestInitWithBody = { method: "PURGE" }; const pick: ErrorDetailResolver = …; const h: HeadersOption = …
+const call: RequestOptionsWithMethod = { method: "PURGE" }; const pick: DescriptionExtractor = …; const h: ArthronClientOptions["headers"] = …

-arthron({ baseURL: API, allowAbsoluteUrls: true })
+arthron({ baseURL: API, allowedOrigins: ["https://cdn.example.com"] }) // list the origins; to reach any, see allowedOrigins above
```

## [1.2.0] — 2026-10-20

### Added

- `uploadProgress()` in `arthron/plugins`: upload progress per call, `meta: { onUploadProgress: ({ loaded, total, progress }) => … }`. It does nothing by itself; only a call that passes the callback changes. In a browser that call goes over `XMLHttpRequest`; in Node the body is counted as `fetch` reads it, keeping `content-length` so S3 presigned uploads work.
- `RequestContext.fetch`: the fetch an attempt is sent with — the client's, else the global one. A plugin can replace it for one attempt or wrap it; failures still become `ArthronError` in one place.

## [1.1.0] — 2026-10-20

### Added

- `arthron/plugins`, where the built-in plugins and their option types now live: `import { bearerAuth, logging, retry, timeout } from "arthron/plugins"`. The main entry keeps the core.
- `bearerAuth({ origin, token, refresh? })`: Bearer tokens with a refresh on 401, built in. The token goes to `origin` only; concurrent 401s share one refresh, a call whose token was already replaced retries without refreshing, and each call is redone once. `meta: { bearerAuth: false }` skips it for one call — the login and refresh endpoints. It replaces the auth-refresh recipe, which `examples/auth-refresh.ts` now shows with the built-in.
- `timeout({ total?, idle? })`. `timeout({ idle: 30_000 })` bounds only the silence of a stream, without the `Infinity` that `timeout(Infinity, { idle })` needed; `timeout(ms)` is unchanged.

### Deprecated

- `logging`, `retry` and `timeout` (and `LogEvent`, `LoggingOptions`, `TimeoutOptions`) from `arthron` — import them from `arthron/plugins`. They are the same functions and keep working until the next major.
- `timeout(ms, { idle })` — use `timeout({ total: ms, idle })`. It keeps working and goes in the next major.

### Fixed

- Error interceptors run only when the request itself failed. An `ArthronError` a plugin throws — a request interceptor whose own call to a token endpoint failed, say — is a plugin exception: it propagates untouched, as documented, instead of going through this request's error interceptors.
- A plugin that returns nothing gets a `TypeError` naming the slot (`a request interceptor returned undefined — return the context …`). Before, an error interceptor that forgot to return made the call reject with `undefined`, and the other slots failed later with `Cannot read properties of undefined`.
- `.sse()` and `.ndjson()` reject a line over `maxLineLength` however the body is chunked. A long line that arrived whole, with its line break, in one chunk was let through.
- A network `ArthronError` keeps the query and userinfo out of `message` and `toJSON()` when the runtime's own message repeats the URL (Deno's does).

## [1.0.1] — 2026-10-19

### Fixed

- Types check in a Node project typed with `@types/node` and no DOM lib. `HeadersOption` named `HeadersInit`, which only the DOM lib declares: such a project got `Cannot find name 'HeadersInit'`, or, with `skipLibCheck`, headers typed as `any`.
- In Safari and other WebKit browsers, an aborted call rejects with its abort reason as documented — the `TimeoutError` of `timeout()`, or the reason passed to `abort(reason)` — for the request and for body reads (`.json()`, `.sse()`, …). WebKit's fetch rejects with a generic `AbortError` instead, which arthron passed on.
- In a browser that cannot stream a request body (Firefox), a `ReadableStream` body rejects with a `TypeError` before anything is sent. Firefox sent the text `"[object ReadableStream]"` instead.

### Changed

- The `ArthronError` for a failed `ReadableStream` upload says that browsers stream a request body only over HTTP/2, and to send a `Blob` or `ArrayBuffer` to an HTTP/1.1 server. Before, it was a bare `Failed to fetch`.

### Documentation

- The minimum supported TypeScript version is 5.0. CI type-checks the published types the way a user's compiler sees them, on every version from 5.0 to 7.0, with bundler and NodeNext resolution, ESM and CJS, and with or without the DOM lib.
- The README describes what differs in browsers: CORS preflights, `Retry-After` behind CORS, opaque redirects, streaming bodies. CI runs the built package in Chromium, Firefox and WebKit against a server on another origin.

## [1.0.0] — 2026-10-19

First stable release. Compared with 0.1.0:

### Breaking

- **Node.js 22+** (`engines.node >=22`); 18 and 20 are past end of life.
- **`ArthronError.message` is arthron's own** — `GET https://api.example.com/users/1 failed with 404 Not Found`, without the query or any server text. What the server said moved to the new `detail` field: show `err.detail ?? fallback` to users, log `message`. Config `errorMessage` is now `errorDetail`, type `ErrorMessageResolver` is now `ErrorDetailResolver`.
- **Absolute URLs stay on `baseURL`'s origin** — with a `baseURL`, an absolute URL to another origin rejects with a `TypeError` unless `allowAbsoluteUrls: true`, and config headers are never sent to another origin. Only `http(s)` URLs are accepted.
- `error.response` holds at most 64 KiB of an error body; past that `data` is the raw text.
- `.sse()` / `.ndjson()` reject a line over `maxLineLength` or an SSE event over `maxEventSize` (8 Mi characters by default).
- `RequestContext.init.headers` is a lowercase `Record<string, string>`, and `RequestContext` has a required `meta`.
- A plugin whose `name` is already on the client replaces it in place instead of stacking (`use`, `extend`).
- Opaque responses and the 3xx of `redirect: "manual"` resolve instead of rejecting.
- `params` arrays become repeated keys (`ids=1&ids=2`). Object or `Date` param values, object bodies under a non-JSON `content-type`, and `Map` / `Set` / iterable / Node stream / function bodies reject with a `TypeError`.
- The default retry delay uses full jitter; `delay`'s error argument is typed `unknown`.
- SSE events carry `lastEventId`, `retry` persists across events and accepts digits only, and an event the stream ends inside is dropped.
- Standard methods are sent uppercased whatever their case (`"patch"` → `PATCH`).
- `timeout(ms)` and `retry({ retries })` reject invalid numbers when created.

### Security

- Absolute URLs can no longer send the client's credentials to another origin (the class of axios CVE-2025-27152).
- `ArthronError` keeps `request`, `response` and `headers` out of `JSON.stringify`, `console.error` and error trackers; `toJSON()` and every message arthron writes leave out query strings and userinfo.
- Error bodies and streams are read with limits, so a hostile server cannot exhaust memory or block the event loop.
- `path: { id }` fills `{id}` placeholders encoded per segment and refuses `""`, `.` and `..`, so ids cannot escape their segment.
- Releases: actions pinned to commit SHAs, npm pinned, workflow tokens read-only, and npm trusted publishing limited to *staging* — a version goes live only after a GitHub environment approval and a maintainer's 2FA approval on npm.

### Added

- Fetch defaults in config, flat like per-call options: `credentials`, `cache`, `redirect`, `mode`, `keepalive`, …
- `meta` per call, readable by plugins and extensible through `ArthronMeta`; `retry` and `timeout` honour `meta.retry` and `meta.timeout`.
- `without(...names)` and name-based plugin replacement.
- `throwOn` to choose which non-ok responses reject.
- `params` as `URLSearchParams`.
- `retry({ shouldRetry, onRetry })`.
- `timeout(ms, { idle })` for streams that may run long but must not go quiet.
- `path` placeholders.
- `HttpMethod` with autocomplete for `request()`.
- `.json(schema)` with any Standard Schema (Zod, Valibot, ArkType, …) and `SchemaError`.
- `query()` for the RFC 10008 QUERY method.
- `.sse(options)` / `.ndjson(options)`, `allowAbsoluteUrls`, `null` header values to drop a default.

### Fixed

- SSE: a CRLF split across chunks no longer creates an extra event; leaving a loop early closes the connection.
- `ReadableStream` bodies are sent with `duplex: "half"`; aborts with a custom reason, or during the error-body read, reject with the abort reason; `.sse()` created early no longer leaves an unhandled rejection; polyfill and cross-realm bodies are recognised; FormData / URLSearchParams bodies are copied per attempt.
- `timeout` keeps `url`, `redirected` and `type` (also through `clone()`) and never keeps Node alive on its own.
- An injected `fetch` that accepts relative URLs works again.
- Headers set by one interceptor survive the next one's spread; FormData is sent without a `content-type` so the boundary is set.
- `isArthronError` and `instanceof ArthronError` work across the ESM and CJS copies.

### Documentation

- The auth-refresh recipe refreshes once for concurrent 401s and only sends the token to the API's origin; the error-page recipe runs once per call. Both are tested.

[1.2.0]: https://github.com/lapidix/arthron/releases/tag/v1.2.0
[1.1.0]: https://github.com/lapidix/arthron/releases/tag/v1.1.0
[1.0.1]: https://github.com/lapidix/arthron/releases/tag/v1.0.1
[1.0.0]: https://github.com/lapidix/arthron/releases/tag/v1.0.0
