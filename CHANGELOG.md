# Changelog

All notable changes to arthron. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

From 1.0.0 arthron follows [Semantic Versioning](https://semver.org/):

- **Major** — removing or changing anything exported from `arthron` (values or types), changing a default behaviour, or raising the minimum supported Node.js or TypeScript version.
- **Minor** — new exports, options or behaviour that is off unless you opt in, and deprecations.
- **Patch** — fixes that keep documented behaviour.

A deprecated API keeps working, is marked `@deprecated` with what to use instead, is listed here, and is removed only in the next major.

## [Unreleased]

### Fixed

- Types check in a Node project typed with `@types/node` and no DOM lib. `HeadersOption` named `HeadersInit`, which only the DOM lib declares: such a project got `Cannot find name 'HeadersInit'`, or, with `skipLibCheck`, headers typed as `any`. [#61]

## [1.0.0] — 2026-10-19

First stable release. Compared with 0.1.0:

### Breaking

- **Node.js 22+** (`engines.node >=22`); 18 and 20 are past end of life. [#41]
- **`ArthronError.message` is arthron's own** — `GET https://api.example.com/users/1 failed with 404 Not Found`, without the query or any server text. What the server said moved to the new `detail` field: show `err.detail ?? fallback` to users, log `message`. Config `errorMessage` is now `errorDetail`, type `ErrorMessageResolver` is now `ErrorDetailResolver`. [#56]
- **Absolute URLs stay on `baseURL`'s origin** — with a `baseURL`, an absolute URL to another origin rejects with a `TypeError` unless `allowAbsoluteUrls: true`, and config headers are never sent to another origin. Only `http(s)` URLs are accepted. [#23]
- `error.response` holds at most 64 KiB of an error body; past that `data` is the raw text. [#25]
- `.sse()` / `.ndjson()` reject a line over `maxLineLength` or an SSE event over `maxEventSize` (8 Mi characters by default). [#26]
- `RequestContext.init.headers` is a lowercase `Record<string, string>`, and `RequestContext` has a required `meta`. [#27] [#28]
- A plugin whose `name` is already on the client replaces it in place instead of stacking (`use`, `extend`). [#29]
- Opaque responses and the 3xx of `redirect: "manual"` resolve instead of rejecting. [#32]
- `params` arrays become repeated keys (`ids=1&ids=2`). Object or `Date` param values, object bodies under a non-JSON `content-type`, and `Map` / `Set` / iterable / Node stream / function bodies reject with a `TypeError`. [#33]
- The default retry delay uses full jitter; `delay`'s error argument is typed `unknown`. [#34]
- SSE events carry `lastEventId`, `retry` persists across events and accepts digits only, and an event the stream ends inside is dropped. [#1] [#36]
- Standard methods are sent uppercased whatever their case (`"patch"` → `PATCH`). [#39]
- `timeout(ms)` and `retry({ retries })` reject invalid numbers when created. [#1]

### Security

- Absolute URLs can no longer send the client's credentials to another origin (the class of axios CVE-2025-27152). [#23]
- `ArthronError` keeps `request`, `response` and `headers` out of `JSON.stringify`, `console.error` and error trackers; `toJSON()` and every message arthron writes leave out query strings and userinfo. [#24]
- Error bodies and streams are read with limits, so a hostile server cannot exhaust memory or block the event loop. [#25] [#26]
- `path: { id }` fills `{id}` placeholders encoded per segment and refuses `""`, `.` and `..`, so ids cannot escape their segment. [#37]
- Releases: actions pinned to commit SHAs, npm pinned, workflow tokens read-only, and npm trusted publishing limited to *staging* — a version goes live only after a GitHub environment approval and a maintainer's 2FA approval on npm. [#31] [#57]

### Added

- Fetch defaults in config, flat like per-call options: `credentials`, `cache`, `redirect`, `mode`, `keepalive`, … [#55]
- `meta` per call, readable by plugins and extensible through `ArthronMeta`; `retry` and `timeout` honour `meta.retry` and `meta.timeout`. [#28]
- `without(...names)` and name-based plugin replacement. [#29]
- `throwOn` to choose which non-ok responses reject. [#32]
- `params` as `URLSearchParams`. [#33]
- `retry({ shouldRetry, onRetry })`. [#34]
- `timeout(ms, { idle })` for streams that may run long but must not go quiet. [#35]
- `path` placeholders. [#37]
- `HttpMethod` with autocomplete for `request()`. [#39]
- `.json(schema)` with any Standard Schema (Zod, Valibot, ArkType, …) and `SchemaError`. [#40]
- `query()` for the RFC 10008 QUERY method.
- `.sse(options)` / `.ndjson(options)`, `allowAbsoluteUrls`, `null` header values to drop a default. [#23] [#26] [#27]

### Fixed

- SSE: a CRLF split across chunks no longer creates an extra event; leaving a loop early closes the connection. [#1]
- `ReadableStream` bodies are sent with `duplex: "half"`; aborts with a custom reason, or during the error-body read, reject with the abort reason; `.sse()` created early no longer leaves an unhandled rejection; polyfill and cross-realm bodies are recognised; FormData / URLSearchParams bodies are copied per attempt. [#1]
- `timeout` keeps `url`, `redirected` and `type` (also through `clone()`) and never keeps Node alive on its own. [#1] [#35]
- An injected `fetch` that accepts relative URLs works again. [#22]
- Headers set by one interceptor survive the next one's spread; FormData is sent without a `content-type` so the boundary is set. [#27]
- `isArthronError` and `instanceof ArthronError` work across the ESM and CJS copies. [#38]

### Documentation

- The auth-refresh recipe refreshes once for concurrent 401s and only sends the token to the API's origin; the error-page recipe runs once per call. Both are tested. [#30]

[#1]: https://github.com/lapidix/arthron/pull/1
[#22]: https://github.com/lapidix/arthron/pull/22
[#23]: https://github.com/lapidix/arthron/pull/23
[#24]: https://github.com/lapidix/arthron/pull/24
[#25]: https://github.com/lapidix/arthron/pull/25
[#26]: https://github.com/lapidix/arthron/pull/26
[#27]: https://github.com/lapidix/arthron/pull/27
[#28]: https://github.com/lapidix/arthron/pull/28
[#29]: https://github.com/lapidix/arthron/pull/29
[#30]: https://github.com/lapidix/arthron/pull/30
[#31]: https://github.com/lapidix/arthron/pull/31
[#32]: https://github.com/lapidix/arthron/pull/32
[#33]: https://github.com/lapidix/arthron/pull/33
[#34]: https://github.com/lapidix/arthron/pull/34
[#35]: https://github.com/lapidix/arthron/pull/35
[#36]: https://github.com/lapidix/arthron/pull/36
[#37]: https://github.com/lapidix/arthron/pull/37
[#38]: https://github.com/lapidix/arthron/pull/38
[#39]: https://github.com/lapidix/arthron/pull/39
[#40]: https://github.com/lapidix/arthron/pull/40
[#41]: https://github.com/lapidix/arthron/pull/41
[#55]: https://github.com/lapidix/arthron/pull/55
[#56]: https://github.com/lapidix/arthron/pull/56
[#57]: https://github.com/lapidix/arthron/pull/57
[#61]: https://github.com/lapidix/arthron/pull/61
[1.0.0]: https://github.com/lapidix/arthron/releases/tag/v1.0.0
