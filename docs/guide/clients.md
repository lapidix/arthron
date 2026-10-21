# Clients

```ts
const api = arthron({
  baseURL: "https://api.example.com", // prefix for relative paths
  headers: { accept: "application/json" }, // defaults; per-call headers win
  credentials: "include", // only if you need cookies cross-origin
  cache: "no-store", // any fetch option works as a default; per-call values win
  plugins: [retry()], // plugins, outermost first
});
```

Every field is optional. **Fetch defaults are flat and only sent when set:** the client takes the same fetch options a call does (`credentials`, `cache`, `redirect`, …) as defaults; a per-call value wins and `extend` overrides. Nothing is sent that you did not set — cross-origin cookies need `credentials: "include"`. `signal`, `body` and `method` belong to one call: a client-wide signal would fail every call once aborted, so passing them to the client throws.

## Where requests and headers go {#where-requests-and-headers-go}

| The client has | Absolute URLs may go to | Its `headers` go to |
|---|---|---|
| `baseURL` | `baseURL`'s origin, and any in `allowedOrigins` | `baseURL`'s origin only — calls to a listed origin carry per-call headers alone |
| `allowedOrigins`, no `baseURL` | the listed origins only | nowhere: client headers are a `TypeError` here |
| neither | any `http(s)` URL | every origin — keep credentials out of them |

`api.get("https://other.example/x")` on a client with a `baseURL` rejects with a `TypeError`, because a path built from user input or an API response must not carry your credentials elsewhere. Same-origin absolute URLs work. `allowedOrigins: ["https://cdn.example.com"]` lists more; only the origin of each URL counts. Only `http(s)` URLs are accepted.

**Redirects follow fetch's rules.** On a redirect to another origin, fetch drops `Authorization` but keeps other headers such as `x-api-key`. Pass `redirect: "error"` (or `"manual"`) for calls that carry such keys if the server could redirect off-origin.

**`fetchFn`** is the function requests are sent with: a fake in tests, a polyfill, a framework's `fetch`. By default it is the global `fetch`, read per request, so a global patched later (msw) is still used. A `fetchFn` you pass is the judge of its own URLs: arthron does not pre-check them, so one that accepts relative URLs (SvelteKit's server-side `fetch`) works with `baseURL: "/api"`.

**Options are checked when the client is created.** An http(s) `baseURL` with no host (`"https://"` from an unset variable), client `headers` with `allowedOrigins` but no `baseURL`, an `allowedOrigins` entry that is not an http(s) URL, a `fetchFn` that is not a function, a 1.x option name — `arthron()` and `extend()` throw a `TypeError` right there, before any request.

## Derive clients {#derive-clients}

Clients are immutable. `use`, `extend` and `without` return a new client and leave the original alone — so keep what they return. `api.use(plugin)` on its own line does nothing.

```ts
const base = arthron({ baseURL: API, plugins: [logging(), retry()] });
const authed = base.use(bearerAuth({ tokenOrigins: [API], accessTokenFn: () => token })); // base + auth
const admin = authed.extend({ headers: { "x-role": "admin" } }); // authed + header
```

`extend` shallow-merges the options, merges headers case-insensitively (child wins), and adds plugins the way `use` does: a plugin whose `pluginName` is already there replaces it in place — so `streaming = base.use(timeout(120_000))` loosens the inherited `timeout`, and a second `retry()` does not multiply attempts — while other names append. `without("retry")` returns a client without that plugin. The built-ins are named `bearerAuth`, `logging`, `retry`, `timeout` and `uploadProgress`.
