# Working in this repo

arthron is a zero-dependency fetch client. Read `README.md` for what it does and `llms.txt` for the compressed API reference. Design notes live locally in `docs/superpowers/` (git-ignored).

## Commands

```sh
pnpm install --frozen-lockfile
pnpm test            # vitest, src/**/*.test.ts and examples/**/*.test.ts
pnpm typecheck       # tsc --noEmit (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
pnpm lint            # biome check .   (pnpm lint:fix to apply)
pnpm build           # tsdown → dist/index.{mjs,cjs,d.mts,d.cts}
pnpm check:types-pkg # attw --pack . — package types must be green for node10/node16/bundler
node scripts/smoke.mjs  # runs dist/ against a real local HTTP server
```

Node 22+ for everything — the dev toolchain and the runtime (`engines`). CI runs the full check, `scripts/smoke.mjs` against the built output included, on 22, 24 and 26.

## Rules

- **Tests first.** Every behaviour change starts with a failing test in the matching `*.test.ts`. Tests inject `fetch` through `ArthronConfig.fetch` (see `src/testkit/fetch.testkit.ts`: `fakeFetch`, `jsonResponse`); never stub `globalThis.fetch`.
- **No runtime dependencies.** `dependencies` stays empty. New dev tooling must work on Node 22+.
- **Node 22 APIs only in `src/`** (and what browsers ship). `AbortSignal.any` is fine; anything newer than Node 22 needs a fallback and a smoke check.
- **Only two things become `ArthronError`:** `!response.ok` and fetch rejecting. Cancellation and plugin exceptions propagate untouched and skip error interceptors. Do not widen this. `throwOn` may only *narrow* which non-ok responses reject (an ok response never does); by default opaque responses and the 3xx of `redirect: "manual"` are returned, not thrown.
- **Interceptors transform, middleware controls flow.** Do not add a way for an interceptor to retry, skip, or swallow. Flow-control features are middleware (see `src/plugins/retry/`, `timeout/`).
- **Clients are immutable.** `use`/`extend` return new instances; never mutate `resolved` after construction.
- **Return native `Response`.** Do not introduce a response wrapper type. Body helpers live on `ArthronPromise` (`src/response/arthron-promise.ts`).
- **Public surface is pinned** by `src/index.test.ts` ("exports exactly the documented values"). Adding an export means updating that list, `README.md`, and `llms.txt` in the same change.
- **Error messages say what to do** (`… — pass baseURL in arthron({ baseURL }) or use an absolute URL`). Keep that style.
- `examples/*.ts` are type-checked (`tsconfig.json` includes them) and import from `../src`. Keep them compiling. `examples/recipes.test.ts` runs the auth and error-page recipes.

## Layout

```
src/
  index.ts      the only public entry — explicit named exports, no `export *`
  client/       arthron() — client.ts (request assembly, use/extend/without),
                send.ts (the one place a failure becomes an ArthronError),
                resolve-config.ts (config resolution, plugins by name)
  pipeline/     runPipeline — middleware onion + per-attempt interceptors; define-plugin.ts identity helpers
  request/      url.ts  body.ts  headers.ts — pure helpers, each with its own tests
  response/     arthron-promise.ts (.json/.sse/… helpers), stream-parser.ts (SSE / NDJSON),
                schema-validation.ts, rebuild-response.ts
  error/        arthron-error.ts (ArthronError, isArthronError), create-error.ts (responseError, networkError …)
  plugins/      one folder per plugin: retry/, timeout/, logging/ ({name}.ts, {name}.types.ts, tests)
  types/        types used by two or more folders: request.types (RequestContext, ArthronMeta, …),
                plugin.types (Plugin, Middleware, interceptors), response.types (ArthronPromise, SSE, schema, …)
  testkit/      fakeFetch, jsonResponse — for tests only
```

### Where a type goes

- Used by one folder → that folder's `{subject}.types.ts` (`client/client.types.ts`, `plugins/timeout/timeout.types.ts`).
- Used by two or more folders, or by a type in `types/` → `types/{subject}.types.ts`.
- `types/` imports nothing outside `types/`, except the `ArthronError` class in `plugin.types.ts`. A folder's `*.types.ts` may import from `types/`.
- No import cycles. `RetryOptions` sits in `types/request.types.ts` because `RequestContext → ArthronMeta → RetryOptions → RequestContext` is one cycle of types; augmenting `ArthronMeta` from another file does not survive the bundled `.d.ts`.

## Commits

`<type>: <summary>` — `feat` `fix` `refactor` `docs` `test` `chore` `ci`; English, imperative, ≤ 50 chars; details in the body. No co-author trailers. Releases are tags `vX.Y.Z` matching `package.json`, each with a `CHANGELOG.md` entry (semver rules are at its top); `.github/workflows/release.yml` (after approval of the `npm` environment) *stages* the version on npm with provenance, and it goes live only when a maintainer approves it with 2FA (`npm stage approve <stage-id>` or npmjs.com). The trusted publisher may only stage — do not switch the workflow back to `npm publish`. The workflow then drafts the GitHub Release with the version's `CHANGELOG.md` entry as notes (`node scripts/release-notes.mjs X.Y.Z` prints them); publish the draft once the stage is approved.
