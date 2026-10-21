# API

## `arthron(clientOptions)`

```ts
type ArthronClientOptions = {
  baseURL?: string;
  allowedOrigins?: readonly string[]; // other origins absolute URLs may go to (only the origin of each URL counts); calls there get per-call headers only. Without baseURL it alone limits absolute URLs, and client headers are refused
  headers?: HeadersInit | Record<string, string | null | undefined>; // sent to baseURL's origin only; a null value drops a header (in extend)
  fetchFn?: typeof fetch; // the function requests are sent with: a fake in tests, a polyfill, a framework's fetch; default the global fetch, read per request
  plugins?: readonly Plugin[]; // outermost first; one with the pluginName of an earlier one replaces it
  extractDescription?: (payload: unknown, response: Response) => string | undefined; // extracts ArthronError.description from a failed response's payload; one that throws leaves it undefined
  throwOn?: (response: Response) => boolean; // which non-ok responses reject (also per call)
  // …plus any fetch option as a default: credentials, cache, redirect, mode,
  // keepalive, referrerPolicy, priority, integrity. Not body, method or signal —
  // those belong to one request (passing them throws).
};
```

## Client

```ts
get(path, requestOptions) · delete(path, requestOptions) · head(path, requestOptions)
post(path, body, requestOptions) · put(path, body, requestOptions) · patch(path, body, requestOptions)
query(path, body, requestOptions) // RFC 10008 QUERY
request(path, { method, body, ...requestOptions })
use(...plugins) → new client (a plugin with the same pluginName is replaced in place)
extend(clientOptions) → new client
without(...pluginNames) → new client without those plugins
```

All arguments after `path` are optional, except `method` in `request`. Every method returns a `ResponsePromise`: a `Promise<Response>` with `.json()`, `.text()`, `.blob()`, `.arrayBuffer()`, `.formData()`, `.sse()` and `.ndjson()`.

## `ArthronError`

```ts
class ArthronError extends Error {
  constructor(options: ArthronErrorOptions); // the fields below, for a test or a plugin that builds one
  status: number; // 0 for network failures
  statusText: string;
  headers: Headers; // the response's headers; not enumerable
  payload: unknown; // the failed response's body, parsed (JSON, else text); undefined for a network failure
  description: string | undefined; // the server's description of the failure, extracted from payload; untrusted text
  response?: Response; // absent for network failures; not enumerable
  requestContext: RequestContext; // what plugins get as requestContext, as sent (url, init.method, init.headers, meta) — not a fetch Request; not enumerable, holds credentials
  cause?: unknown; // the underlying error for network failures (query and userinfo redacted)
  toJSON(): { name; message; description; status; statusText; method; url; payload }; // url without query/userinfo
}
```

## Types

From `arthron`: `ArthronClient`, `ArthronClientOptions`, `RequestOptions`, `RequestOptionsWithMethod`, `HttpMethod`, `QueryParams`, `RequestContext`, `ArthronMeta`, `Plugin`, `Middleware`, `RequestInterceptor`, `ResponseInterceptor`, `ErrorInterceptor`, `ResponsePromise`, `SseEvent`, `SseOptions`, `NdjsonOptions`, `ArthronSchema` (with `.Infer`, `.Issue`, `.ValidationResult`), `DescriptionExtractor`, `ArthronErrorOptions`. From `arthron/plugins`: the built-ins' option and event types listed under [Built in](/plugins/#built-in).

The public object types — `ArthronClientOptions`, `RequestOptions`, `RequestOptionsWithMethod`, `RequestContext`, `ArthronMeta`, `Plugin`, `ResponsePromise`, `ArthronClient`, `ArthronSchema` — are interfaces, so a plugin package can add its own options with `declare module "arthron" { interface RequestOptions { … } }`.
