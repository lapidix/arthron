# Working in this repo

arthron is a zero-dependency fetch client. Read the docs in `docs/` for what it does and `llms.txt` for the compressed API reference. Design notes live locally in `docs/superpowers/` (git-ignored).

## Commands

```sh
pnpm install --frozen-lockfile
pnpm test            # vitest, src/**/*.test.ts, examples/**/*.test.ts and scripts/**/*.test.ts
pnpm typecheck       # tsc --noEmit (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
pnpm lint            # biome check .   (pnpm lint:fix to apply)
pnpm build           # tsdown → dist/{index,plugins,shared}.{mjs,cjs,d.mts,d.cts}, no sourcemaps
pnpm check:types-pkg # attw --pack . — package types must be green for node10/node16/bundler
pnpm check:types-consumer  # after build and `pnpm install --dir test/types-consumer`: the packed types on TS 5.0–7.0
pnpm check:browsers  # after build, `pnpm install --dir test/browser` and `pnpm --dir test/browser exec playwright install`: the package in Chromium, Firefox and WebKit
node scripts/smoke.mjs  # runs dist/ against a real local HTTP server
pnpm install --dir docs  # once, for the docs site (VitePress lives in docs/ with its own lockfile)
pnpm docs:dev        # the docs site with live reload
pnpm docs:build      # builds the docs site to docs/.vitepress/dist
```

Node 22+ for everything — the dev toolchain and the runtime (`engines`). CI runs the full check, `scripts/smoke.mjs` against the built output included, on 22, 24 and 26.

## Rules

- **Tests first.** Every behaviour change starts with a failing test in the matching `*.test.ts`. Tests inject `fetch` through `ArthronClientOptions.fetchFn` (see `src/testkit/fetch.testkit.ts`: `fakeFetch`, `jsonResponse`); never stub `globalThis.fetch`.
- **No runtime dependencies.** `dependencies` stays empty. New dev tooling must work on Node 22+.
- **TypeScript 5.0+ for users.** The published types must pass `pnpm check:types-consumer` on every version pinned in `test/types-consumer/package.json`, the lowest being the supported minimum. Raising it is a major change. A new TypeScript release gets a new pinned version there.
- **Node 22 APIs only in `src/`** (and what browsers ship). `AbortSignal.any` is fine; anything newer than Node 22 needs a fallback and a smoke check.
- **Only two things become `ArthronError`:** `!response.ok` and fetch rejecting. Cancellation and plugin exceptions propagate untouched and skip error interceptors. Do not widen this. `throwOn` may only *narrow* which non-ok responses reject (an ok response never does); by default opaque responses and the 3xx of `redirect: "manual"` are returned, not thrown.
- **Interceptors transform, middleware controls flow.** A plugin's interceptors are `requestInterceptor`, `responseInterceptor` and `errorInterceptor`. Do not add a way for an interceptor to retry, skip, or swallow. Flow-control features are middleware (see `src/plugins/retry/`, `timeout/`).
- **Clients are immutable.** `use`/`extend` return new instances; never mutate `resolved` after construction.
- **Return native `Response`.** Do not introduce a response wrapper type. Body helpers live on `ResponsePromise` (`src/response/response-promise.ts`).
- **Public surface is pinned** by `src/index.test.ts` and `src/plugins/index.test.ts` ("exports exactly the documented values"). Adding an export means updating that list, the docs pages, and `llms.txt` in the same change. Built-in plugins and their option types are exported from `arthron/plugins` only.
- **Error messages say what to do** (`… — pass baseURL in arthron({ baseURL }) or use an absolute URL`). Keep that style.
- **The docs site deploys on Latest releases.** Publishing a release as Latest deploys it; running the Docs workflow by hand deploys the ref you pick, which must be `main` or a `v*` tag (the `github-pages` environment refuses other branches), so from `main` it also publishes docs for anything not released yet.
- `examples/*.ts` are type-checked (`tsconfig.json` includes them) and import from `../src`. Keep them compiling. `examples/recipes.test.ts` runs the error-page recipe.

## Layout

```
src/
  index.ts      the `arthron` entry — explicit named exports, no `export *`
  plugins/index.ts  the `arthron/plugins` entry (plugins/package.json at the root resolves it for node10)
  client/       arthron() — client.ts (request assembly, use/extend/without),
                send.ts (the one place a failure becomes an ArthronError),
                resolve-options.ts (client options checked and resolved, plugins by pluginName, 1.x option names)
  pipeline/     runPipeline — middleware onion + per-attempt interceptors; create-plugin.ts createPlugin, its checks and the create… helpers
  request/      url.ts  body.ts  headers.ts — pure helpers, each with its own tests
  response/     response-promise.ts (.json/.sse/… helpers), stream-parser.ts (SSE / NDJSON),
                schema-validation.ts, rebuild-response.ts
  error/        arthron-error.ts (ArthronError, isArthronError), create-error.ts (responseError, networkError …)
  plugins/      one folder per plugin: bearer-auth/, retry/, timeout/, logging/, upload-progress/
                ({name}.ts, a {name}.types.ts where the plugin has types of its own, tests)
  types/        types used by two or more folders: request.types (RequestContext, ArthronMeta, …),
                plugin.types (Plugin, Middleware, interceptors), response.types (ResponsePromise, SSE, schema, …)
  testkit/      fakeFetch, jsonResponse — for tests only
docs/           the documentation site (VitePress, English): guide/, plugins/, reference/, agents.md;
                its own package.json and lockfile, deployed by .github/workflows/docs.yml
```

### Where a type goes

- Used by one folder → that folder's `{subject}.types.ts` (`client/client.types.ts`, `plugins/logging/logging.types.ts`).
- Used by two or more folders, or by a type in `types/` → `types/{subject}.types.ts`.
- `types/` imports nothing outside `types/`, except the `ArthronError` class in `plugin.types.ts`. A folder's `*.types.ts` may import from `types/`.
- No import cycles. `RetryOptions` and `TimeoutOptions` sit in `types/request.types.ts` because `ArthronMeta` names both, and `RequestContext → ArthronMeta → RetryOptions → RequestContext` is one cycle of types; augmenting `ArthronMeta` from another file does not survive the bundled `.d.ts`.

## Commits

`<type>: <summary>` — `feat` `fix` `refactor` `docs` `test` `chore` `ci`; English, imperative, ≤ 50 chars; details in the body. No co-author trailers. Releases are tags `vX.Y.Z` matching `package.json`, each with a `CHANGELOG.md` entry (semver rules are at its top). Merging the version bump (`chore: release X.Y.Z`) to main is the release: `.github/workflows/tag-release.yml` tags that commit and starts the Release workflow on the tag — no tag by hand, which could land on a commit with the old version. `.github/workflows/release.yml` (after approval of the `npm` environment) *stages* the version on npm with provenance, and it goes live only when a maintainer approves it with 2FA. The trusted publisher may only stage — do not switch the workflow back to `npm publish`. The workflow then drafts the GitHub Release with the version's `CHANGELOG.md` entry as notes (`node scripts/release-notes.mjs X.Y.Z` prints them). `pnpm release:approve` finishes the release: it approves the stage, waits for the version on npm, then publishes the draft, as Latest when npm's `latest` is that version. Approved on npmjs.com instead? Run it anyway — it skips the approval and still publishes the draft. `scripts/dist-tag.mjs` picks the npm dist-tag the stage goes under: `next` for a prerelease (`2.0.0-rc.1`), `latest-<major>` for an older major, `latest` otherwise; CI checks that `CHANGELOG.md` has an entry for `package.json`'s version before a release PR merges.

### Maintenance releases

Once a new major is out, the previous one gets security fixes for six months (SECURITY.md) on a `vN.x` branch — `v1.x` for 1.x, created from the `v1.2.0` tag when the first fix is needed (`git switch -c v1.x v1.2.0`). Its first PR brings the release tooling over from main — `tag-release.yml`, `release.yml`, `ci.yml`, `scripts/dist-tag.mjs`, `scripts/approve-release.mjs` and the `release:approve` script — because a push to `v1.x`, and a tag on it, run the workflows as they are on that branch. Fix on main first, with its test, then `git cherry-pick -x` it onto `v1.x` in a PR that targets `v1.x`. Release with a `chore: release 1.2.x` PR to `v1.x` that bumps `package.json` and adds the `CHANGELOG.md` entry: merging it tags `v1.2.x` and stages it under `latest-1` (npm refuses `v1`, a semver range, as a tag), so `latest` stays on the newest major. Finish with `pnpm release:approve 1.2.x` — pass the version, since main's `package.json` names another; the GitHub Release is published without the Latest mark.
