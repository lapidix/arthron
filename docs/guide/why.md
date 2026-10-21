# Why arthron

- **Plain `Response` in, plain `Response` out.** No wrapper type to learn: `await api.get(…)` is the `Response` fetch gave, and `.json()`, `.sse()` and friends are there when you want the body.
- **Everything beyond fetch is a plugin.** Retry, timeouts, auth refresh, logging and upload progress are plugins built on the same API yours use. A plugin holds middleware, which controls the flow (retry, skip, deadlines), and interceptors, which transform one value; the types keep the two apart.
- **One error type, two causes.** `ArthronError` means the server said no (`!response.ok`) or the network failed (`status: 0`). Everything else — cancellation, a bug in a plugin — is rethrown as-is.
- **Safe by default.** Requests stay on `baseURL`'s origin unless you list others, and the client's headers never leave it. Path values cannot escape their segment. Errors never print your tokens or query strings. Error bodies and streams are read within limits.
- **Mistakes fail loudly.** A wrong option, a body JSON would mangle, a 1.x name: each is a `TypeError` that says what to write instead, before anything is sent.
- **Small and portable.** Zero dependencies. ESM and CJS. TypeScript 5.0+. Node 22+ and browsers — CI runs the built package in Chromium, Firefox and WebKit.
