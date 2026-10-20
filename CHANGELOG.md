# Changelog

All notable changes to arthron. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

From 1.0.0 arthron follows [Semantic Versioning](https://semver.org/):

- **Major** — removing or changing anything exported from `arthron` (values or types), changing a default behaviour, or raising the minimum supported Node.js or TypeScript version.
- **Minor** — new exports, options or behaviour that is off unless you opt in, and deprecations.
- **Patch** — fixes that keep documented behaviour.

A deprecated API keeps working, is marked `@deprecated` with what to use instead, is listed here, and is removed only in the next major.

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

[1.1.0]: https://github.com/lapidix/arthron/releases/tag/v1.1.0
[1.0.1]: https://github.com/lapidix/arthron/releases/tag/v1.0.1
[1.0.0]: https://github.com/lapidix/arthron/releases/tag/v1.0.0
