# Working in this repo

arthron is a zero-dependency fetch client. Read `README.md` for what it does and `llms.txt` for the compressed API reference. Design decisions and their reasons are in `docs/superpowers/specs/`.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm test            # vitest, src/**/*.test.ts
pnpm typecheck       # tsc --noEmit (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
pnpm lint            # biome check .   (pnpm lint:fix to apply)
pnpm build           # tsdown → dist/index.{mjs,cjs,d.mts,d.cts}
pnpm check:types-pkg # attw --pack . — package types must be green for node10/node16/bundler
node scripts/smoke.mjs  # runs dist/ against a real local HTTP server
```

The dev toolchain needs Node 22+. Runtime support is Node 18+; CI proves it by running `scripts/smoke.mjs` on 18 and 20 against the built output.

## Rules

- **Tests first.** Every behaviour change starts with a failing test in the matching `*.test.ts`. Tests inject `fetch` through `ArthronConfig.fetch` (see `src/test-utils.ts`: `fakeFetch`, `jsonResponse`); never stub `globalThis.fetch`.
- **No runtime dependencies.** `dependencies` stays empty. New dev tooling must work on Node 22+.
- **Node 18 APIs only in `src/`.** No `AbortSignal.any`, `AbortSignal.timeout`, `Promise.withResolvers`, `Array.prototype.toSorted`, etc. If you need one, add the Node 18 fallback and a smoke check.
- **Only two things become `ArthronError`:** `!response.ok` and fetch rejecting. Cancellation and plugin exceptions propagate untouched and skip error interceptors. Do not widen this.
- **Interceptors transform, middleware controls flow.** Do not add a way for an interceptor to retry, skip, or swallow. Flow-control features are middleware (see `src/plugins/retry.ts`, `timeout.ts`).
- **Clients are immutable.** `use`/`extend` return new instances; never mutate `resolved` after construction.
- **Return native `Response`.** Do not introduce a response wrapper type. Body helpers live on `ArthronPromise` (`src/promise.ts`).
- **Public surface is pinned** by `src/index.test.ts` ("exports exactly the documented values"). Adding an export means updating that list, `README.md`, and `llms.txt` in the same change.
- **Error messages say what to do** (`… — pass baseURL in arthron({ baseURL }) or use an absolute URL`). Keep that style.
- `examples/*.ts` are type-checked (`tsconfig.json` includes them) and import from `../src`. Keep them compiling.

## Layout

```
src/
  client.ts     arthron() — config resolution, request assembly, send()
  pipeline.ts   runPipeline — middleware onion + per-attempt interceptors
  promise.ts    ArthronPromise helpers (.json/.text/.blob/.sse/.ndjson …)
  stream.ts     SSE / NDJSON parsers
  error.ts      ArthronError, isArthronError, responseError, networkError
  url.ts  body.ts  headers.ts   pure helpers, each with its own tests
  define.ts     identity helpers for plugin typing
  plugins/      retry, timeout, logging
  index.ts      the only public entry — explicit named exports, no `export *`
```

## Commits

`<type>: <summary>` — `feat` `fix` `docs` `test` `chore` `ci`; English, imperative, ≤ 50 chars; details in the body. No co-author trailers. Releases are tags `vX.Y.Z` matching `package.json`; `.github/workflows/release.yml` publishes with provenance.
