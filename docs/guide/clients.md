# Clients

A client holds what every call shares: where requests go, default headers and fetch options, and plugins. This page covers the options, where a client may send requests and headers, and how to derive one client from another.

## ArthronClientOptions

`arthron(clientOptions)` creates a client:

```ts
const api = arthron({
  // prefix for relative paths
  baseURL: "https://api.example.com",
  // defaults; per-call headers win
  headers: { accept: "application/json" },
  // only if you need cookies cross-origin
  credentials: "include",
  // any fetch option works as a default; per-call values win
  cache: "no-store",
  // plugins, outermost first
  plugins: [retry()],
});
```

Every field is optional. The whole type:

```ts
type ArthronClientOptions = {
  baseURL?: string;
  // other origins absolute URLs may go to (only the origin
  // of each URL counts); calls there get per-call headers
  // only. Without baseURL it alone limits absolute URLs,
  // and client headers are refused
  allowedOrigins?: readonly string[];
  // sent to baseURL's origin only; a null value drops a
  // header (in extend)
  headers?:
    | HeadersInit
    | Record<string, string | null | undefined>;
  // the function requests are sent with: a fake in tests,
  // a polyfill, a framework's fetch; default the global
  // fetch, read per request
  fetchFn?: typeof fetch;
  // outermost first; one with the pluginName of an earlier
  // one replaces it
  plugins?: readonly Plugin[];
  // extracts ArthronError.description from a failed
  // response's payload; one that throws leaves it undefined
  extractDescription?: (
    payload: unknown,
    response: Response,
  ) => string | undefined;
  // which non-ok responses reject (also per call)
  throwOn?: (response: Response) => boolean;
  // …plus any fetch option as a default: credentials,
  // cache, redirect, mode, keepalive, referrerPolicy,
  // priority, integrity. Not body, method or signal —
  // those belong to one request (passing them throws).
};
```

### Fetch defaults

The client takes the same fetch options a call does (`credentials`, `cache`, `redirect`, …) as defaults. They are flat, like a call's options, and only sent when set.

- A per-call value wins.
- `extend` overrides them.
- Nothing is sent that you did not set. Cross-origin cookies need `credentials: "include"`.

### Options that belong to one call

`signal`, `body` and `method` belong to one call. Passing them to the client throws.

A client-wide signal would fail every call once it was aborted.

## Where requests and headers go {#where-requests-and-headers-go}

`baseURL` and `allowedOrigins` decide which absolute URLs a call may request, and which origins get the client's `headers`.

| The client has | Absolute URLs may go to | Its `headers` go to |
| --- | --- | --- |
| `baseURL` | `baseURL`'s origin, and any in `allowedOrigins` | `baseURL`'s origin only. Calls to a listed origin carry per-call headers alone. |
| `allowedOrigins`, no `baseURL` | the listed origins only | nowhere: client headers are a `TypeError` here |
| neither | any `http(s)` URL | every origin. Keep credentials out of them. |

### Other origins

On a client with a `baseURL`, an absolute URL to another origin rejects with a `TypeError`:

```ts
api.get("https://other.example/x"); // rejects
```

That way, a path built from user input or an API response cannot carry your credentials elsewhere.

- Same-origin absolute URLs work.
- `allowedOrigins` lists more origins: `allowedOrigins: ["https://cdn.example.com"]`. Only the origin of each URL counts.
- Only `http(s)` URLs are accepted.

### Redirects

Redirects follow fetch's rules. On a redirect to another origin, fetch drops `Authorization` but keeps other headers, such as `x-api-key`.

::: warning
If the server could redirect off-origin, pass `redirect: "error"` (or `"manual"`) for calls that carry such keys.
:::

## fetchFn

`fetchFn` is the function requests are sent with: a fake in tests, a polyfill, a framework's `fetch`.

By default it is the global `fetch`, read per request. A global patched later, as msw does, is still used.

A `fetchFn` you pass is the judge of its own URLs. arthron does not pre-check them, so one that accepts relative URLs, such as SvelteKit's server-side `fetch`, works with `baseURL: "/api"`.

## When an option is wrong

Options are checked when the client is created. `arthron()` and `extend()` throw a `TypeError` right there, before any request, for:

- an http(s) `baseURL` with no host, such as `"https://"` from an unset variable
- client `headers` with `allowedOrigins` but no `baseURL`
- an `allowedOrigins` entry that is not an http(s) URL
- a `fetchFn` that is not a function
- a 1.x option name

## Derive clients {#derive-clients}

Clients are immutable. `use`, `extend` and `without` return a new client and leave the original alone.

| Method | The new client |
| --- | --- |
| `use(...plugins)` | adds the plugins; one with the `pluginName` of a plugin already there replaces it in place |
| `extend(clientOptions)` | combines the client's options with these |
| `without(...pluginNames)` | leaves out the plugins of these names |

::: tip
Keep what they return. `api.use(plugin)` on its own line does nothing.
:::

```ts
const base = arthron({
  baseURL: API,
  plugins: [logging(), retry()],
});
// base + auth
const authed = base.use(
  bearerAuth({
    tokenOrigins: [API],
    accessTokenFn: () => token,
  }),
);
// authed + header
const admin = authed.extend({
  headers: { "x-role": "admin" },
});
```

### extend

`extend` combines the client's options with the ones you pass:

- The options are shallow-merged.
- Headers are merged case-insensitively, and the child's win.
- Plugins are added the way `use` adds them.

### Adding plugins

`use`, and `extend` with `plugins`, add plugins by their `pluginName`:

- A plugin whose `pluginName` is already there replaces it in place.
- A plugin with any other name is appended.

So `streaming = base.use(timeout(120_000))` loosens the inherited `timeout`, and a second `retry()` does not multiply attempts.

### Removing plugins

`without("retry")` returns a client without that plugin.

The built-ins are named `bearerAuth`, `logging`, `retry`, `timeout` and `uploadProgress`.

## Types

Both come from `arthron`.

| Type | What it is |
| --- | --- |
| `ArthronClient` | What `arthron()` returns: the request methods on [Requests](/guide/requests), plus `use`, `extend` and `without` |
| `ArthronClientOptions` | What `arthron()` and `extend()` take; the whole type is [above](#arthronclientoptions) |
