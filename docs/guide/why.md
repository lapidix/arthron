# Why arthron

arthron is a lightweight `fetch` client you assemble from plugins. These are the choices behind it.

## Plain Response in, plain Response out

There is no wrapper type to learn. `await api.get(…)` is the `Response` fetch gave.

`.json()`, `.sse()` and friends are there when you want the body. See [Responses](/guide/responses).

## Everything beyond fetch is a plugin

Retry, timeouts, auth refresh, logging and upload progress are plugins. They are built on the same API yours use.

A plugin holds two kinds of parts, and the types keep the two apart:

- Middleware controls the flow: retry, skip, deadlines.
- Interceptors transform one value.

See [Plugins](/plugins/).

## One error type, two causes

`ArthronError` means one of two things:

- the server said no (`!response.ok`)
- the network failed (`status: 0`)

Everything else, such as cancellation or a bug in a plugin, is rethrown as it is. See [Errors](/guide/errors).

## Safe by default

- Requests stay on `baseURL`'s origin unless you list others, and the client's headers never leave it. See [Where requests and headers go](/guide/clients#where-requests-and-headers-go).
- Path values cannot escape their segment.
- Error messages omit URL query strings and userinfo; error serialization excludes request headers and bodies. Server-provided error payloads may still contain secrets.
- Error bodies and streams are read within limits.

## Mistakes fail loudly

Common configuration mistakes, bodies that cannot be safely serialized as JSON, and most 1.x names produce a `TypeError` that says what to change. Request argument errors fail before anything is sent.

## Small and portable

- Zero dependencies.
- ESM and CJS.
- TypeScript 5.0+.
- Node 22+ and browsers. CI runs the built package in Chromium, Firefox and WebKit; see [In browsers](/guide/browsers).
