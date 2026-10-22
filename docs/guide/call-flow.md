# How a call flows

What happens between `api.get(…)` and the `Response` you get back: the work done before any plugin runs, middleware, attempts, and where errors come from.

## Overview

```text
api.get(path, requestOptions)
  │  fill pathParams
  │  join baseURL + path + queryParams
  │  check the origin (baseURL / allowedOrigins)
  │  merge headers · serialize the body
  ▼
middleware[0] → middleware[1] → …
  │  outermost first; the outermost runs once per call
  │  next(requestContext)
  │  a middleware may call it again (retry)
  ▼
attempt ─ request interceptors → fetchFn(url, init)
  ├─ ok, or let through by throwOn
  │    → response interceptors → Response
  ├─ !ok, or the network failed
  │    → ArthronError → error interceptors → thrown
  └─ cancelled, or a plugin threw
       → passed through untouched
  ▲
middleware resumes after `await next(…)`, last one first
  ▼
ResponsePromise ─ await → Response
  · .json() .text() .sse() .ndjson()
```

## Before the plugins

The URL is built and its origin checked. The client's and the call's headers are merged, and the body is serialized.

A mistake here is a rejected `TypeError`, and no plugin runs. For example:

- a relative path with no `baseURL`
- a body JSON would mangle
- an origin the client may not call

See [When an argument is wrong](/guide/requests#when-an-argument-is-wrong).

## Middleware

Middleware wraps the whole call, outermost first.

`await next(requestContext)` runs everything below it. The middleware then resumes with the result, or with the error to `catch`.

A middleware may call `next` again, which is a retry, or not at all.

### How often a middleware runs

The outermost middleware runs once per call. A middleware below one that calls `next` again runs again each time.

With `plugins: [retry(), timeout(5_000)]`, the timeout runs inside `retry`, so it applies to each attempt.

What each slot gets and returns, and which to use, is on [Middleware and interceptors](/plugins/middleware-and-interceptors).

## Attempts

An attempt is one trip to the network: request interceptors, then `fetchFn`, then response or error interceptors.

A retry runs the whole attempt again. A refreshed token or a new trace id is picked up without extra code.

Each attempt starts from a fresh copy of the context.

## Where errors come from

Only two things become an `ArthronError`, and only those reach error interceptors:

- a non-ok response, unless `throwOn` lets it through
- a failed `fetch`

Cancellation and exceptions thrown by plugins pass through untouched. See [Errors](/guide/errors).

## What you get back

The middleware unwinds, last one first, and the call resolves with the `Response`.

The `Response` is untouched unless a response interceptor or a middleware returned a different one.

The body helpers, such as `.json()`, `.text()`, `.sse()` and `.ndjson()`, sit on top of that promise. See [Responses](/guide/responses).
