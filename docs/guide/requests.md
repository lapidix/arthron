# Requests

Every call is a method on the client. It resolves with the `Response` fetch gave; the helpers that read the body sit on the same promise, see [Responses](/guide/responses).

## Methods

```ts
await api.get("/users", { queryParams: { page: 2 } });
await api.post("/users", { name: "kim" }); // object → JSON
await api.post("/upload", formData); // sent as it is
await api.put("/users/1", { name: "lee" });
await api.patch("/users/1", { name: "lee" });
await api.delete("/users/1");
await api.head("/users/1");
await api.query("/search", { filter: { tag: "x" } });
await api.request("/users", { method: "OPTIONS" });
```

| Method | Arguments |
| --- | --- |
| `get`, `delete`, `head` | `(path, requestOptions?)` |
| `post`, `put`, `patch`, `query` | `(path, body?, requestOptions?)` |
| `request` | `(path, { method, body?, ...requestOptions })` |

Every argument after `path` is optional, except `method` in `request`. Each method returns a `ResponsePromise`: a `Promise<Response>` with `.json()`, `.text()`, `.blob()`, `.arrayBuffer()`, `.formData()`, `.sse()` and `.ndjson()`.

### QUERY

`query` sends the [RFC 10008](https://www.rfc-editor.org/rfc/rfc10008) QUERY method. It is safe and idempotent like GET, so `retry()` repeats it by default, but the query travels in the body. Any `fetch` can send it; the server has to understand it. Node's own `http` server does from v20.

### Other verbs

`request` sends any other method. Its `method` autocompletes the standard ones, and those go out uppercased whatever case you write them in. fetch itself leaves `"patch"` lowercase, and servers answer that with a 405. Any other method name is sent as written.

## Request options

The last argument, `requestOptions`, takes everything `fetch` does (`signal`, `cache`, `headers`, …) and four options of arthron's own:

| Option | What it does |
| --- | --- |
| `queryParams` | Adds a query string. |
| `pathParams` | Fills the `{name}` placeholders in the path. |
| `meta` | Settings for plugins on this call. It is never sent; see [Plugins](/plugins/). |
| `throwOn` | Picks which non-ok responses reject on this call; see [Errors](/guide/errors). |

### Query parameters

```ts
api.get("/users", {
  queryParams: { page: 2, tag: ["a", "b"], q: undefined },
});
// → /users?page=2&tag=a&tag=b
```

- A `null` or `undefined` value is left out.
- An array becomes a repeated key: `{ ids: [1, 2] }` → `ids=1&ids=2`.
- A `URLSearchParams` is used as it is.
- Any other object value, such as a `Date` or a nested object, is a `TypeError` rather than `[object Object]` in the URL. Pass `date.toISOString()` for a date.

### Path parameters

```ts
api.get("/users/{id}", { pathParams: { id } });
```

Each value is encoded into its own segment, so an id like `../admin` or `x?role=admin` cannot change which endpoint you call. `encodeURIComponent` alone lets `..` through.

These are a `TypeError`, and nothing is sent:

- an empty value, `.` or `..`
- a placeholder without a value
- a value without a placeholder

Without `pathParams`, braces are left in the path as they are.

::: tip
Use `pathParams` instead of building the path with a template string. It is the reason a hostile id cannot reach another endpoint.
:::

### Headers

`headers` takes what fetch takes. A `null` or `undefined` value also drops a client default for this call:

```ts
api.get("/public", { headers: { authorization: null } });
```

## URLs

The path is appended to `baseURL` as a string, so a path prefix in `baseURL` survives. `new URL("/users", base)` would drop it.

```ts
const api = arthron({ baseURL: "https://api.example.com/v1" });

api.get("/users");
// → https://api.example.com/v1/users
api.get("/users?sort=name", { queryParams: { page: 2 } });
// → https://api.example.com/v1/users?sort=name&page=2
```

The query goes after any query the path already has, joined with `&`, and before a `#fragment`. Where absolute URLs may go is set on the client; see [Where requests and headers go](/guide/clients#where-requests-and-headers-go).

## Bodies

| You pass | It is sent |
| --- | --- |
| `string`, `FormData`, `Blob`, `ArrayBuffer` or a view, `URLSearchParams`, `ReadableStream` | as it is |
| anything else, `null` included | as JSON, with `content-type: application/json` |
| `Map`, `Set`, a generator, a Node stream, a function | not at all: a `TypeError` that says what to pass instead |

- Bodies are recognised by their type tag, so instances from a polyfill or another realm count too.
- A `ReadableStream` is sent with `duplex: "half"`, which fetch requires.
- A body sent as JSON needs a JSON content type. If you set another one, the call is a `TypeError`.
- A `FormData` body is sent without a `content-type` header, even when the client has a JSON default, so the runtime can add the multipart boundary.
- `GET` and `HEAD` cannot carry a body; passing one is a `TypeError`.

## When an argument is wrong

A wrong argument rejects the call's promise with a `TypeError` before anything is sent. It does not throw where you call, and it is never retried as a failed request (`status: 0`).

- a relative path without a `baseURL`
- a URL that does not parse, such as `baseURL: "api.example.com"` without `https://`
- a `BigInt` in a JSON body
- `request` without a `method`

The URL check applies to the global fetch. A `fetchFn` you pass decides its own URL rules, and may accept a relative URL.

## Types

All four come from `arthron`.

| Type | What it is |
| --- | --- |
| `RequestOptions` | The options of one call: fetch's, plus `queryParams`, `pathParams`, `meta` and `throwOn` |
| `RequestOptionsWithMethod` | What `request` takes: `RequestOptions` with a `method` and a `body` |
| `HttpMethod` | The methods arthron knows by name, for autocomplete; any other string is allowed too |
| `QueryParams` | What `queryParams` takes: an object of values or arrays, or a `URLSearchParams` |
