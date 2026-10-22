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
  <a href="https://lapidix.github.io/arthron/"><img alt="TypeScript types included" src="https://img.shields.io/npm/types/arthron?color=14b8a6"></a>
  <a href="https://github.com/lapidix/arthron/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/arthron?color=14b8a6"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="https://lapidix.github.io/arthron/">Documentation</a> ·
  <a href="https://lapidix.github.io/arthron/plugins/">Plugins</a> ·
  <a href="#for-agents">For agents</a> ·
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

- **Plain `Response` in, plain `Response` out.** `await api.get(…)` is the `Response` fetch gave; `.json()`, `.sse()` and friends read the body when you want it.
- **Everything beyond fetch is a plugin.** Retry, timeouts, auth refresh, logging and upload progress use the same API yours do.
- **One error type, two causes.** `ArthronError` means the server said no or the network failed; anything else is rethrown as it is.
- **Safe by default.** Requests and the client's headers stay on `baseURL`'s origin, path values cannot escape their segment, and errors never print your tokens.
- **Mistakes fail loudly.** A wrong option, a body JSON would mangle or a 1.x name is a `TypeError` that says what to write instead, before anything is sent.
- **Small and portable.** Zero dependencies, ESM and CJS, TypeScript 5.0+, Node 22+ and browsers.

## Plugins

The built-ins come from `arthron/plugins`. They are plain plugins: anything they do, [yours can](https://lapidix.github.io/arthron/plugins/write-your-own).

| Plugin | What it does |
| --- | --- |
| [`retry`](https://lapidix.github.io/arthron/plugins/retry) | Repeats a failed attempt |
| [`timeout`](https://lapidix.github.io/arthron/plugins/timeout) | Aborts a slow or silent call |
| [`logging`](https://lapidix.github.io/arthron/plugins/logging) | Logs one line when a call starts and one when it ends |
| [`bearerAuth`](https://lapidix.github.io/arthron/plugins/bearer-auth) | Sends a token, refreshes on 401 |
| [`uploadProgress`](https://lapidix.github.io/arthron/plugins/upload-progress) | Reports upload progress |

## Documentation

Everything else is on the [documentation site](https://lapidix.github.io/arthron/):

| Page | What it covers |
| --- | --- |
| [Requests](https://lapidix.github.io/arthron/guide/requests) | Methods, request options, URLs and bodies |
| [Responses](https://lapidix.github.io/arthron/guide/responses) | Body helpers, schema validation and streams |
| [Errors](https://lapidix.github.io/arthron/guide/errors) | `ArthronError`, what to show and log, and `throwOn` |
| [Clients](https://lapidix.github.io/arthron/guide/clients) | Client options, where requests and headers go, and deriving clients |
| [In browsers](https://lapidix.github.io/arthron/guide/browsers) | CORS, redirects and streaming bodies |
| [How a call flows](https://lapidix.github.io/arthron/guide/call-flow) | What happens between `api.get(…)` and the `Response` |
| [Middleware and interceptors](https://lapidix.github.io/arthron/plugins/middleware-and-interceptors) | The two kinds of plugin slots, and which to use |
| [Moving from 1.x](CHANGELOG.md#moving-from-1x) | Every 1.x name and its 2.0 one |

## For agents

- **`llms.txt`** is the whole API in one compressed file, for LLM-based tools. It ships in the package (`node_modules/arthron/llms.txt`) and is served at [https://lapidix.github.io/arthron/llms.txt](https://lapidix.github.io/arthron/llms.txt).
- **Error messages state the fix**, and most 1.x names throw a `TypeError` naming the new one, so an agent working from an old example is told what to change.
- **[`examples/`](examples)** holds type-checked, runnable recipes: LLM streaming, auth refresh, an error page, upload and download.

## Security

Report vulnerabilities privately through GitHub — see [SECURITY.md](SECURITY.md) for supported versions, response times and disclosure.

## License

MIT
