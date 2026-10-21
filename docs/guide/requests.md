# Requests

```ts
await api.get("/users", { queryParams: { page: 2 } }); // → Response
await api.post("/users", { name: "kim" }); // object body → JSON
await api.post("/upload", formData); // FormData/Blob/string/stream → sent as-is
await api.put("/users/1", { name: "lee" });
await api.patch("/users/1", { name: "lee" });
await api.query("/search", { filter: { tag: "x" } }); // RFC 10008 QUERY: GET semantics, body carries the query
await api.delete("/users/1");
await api.head("/users/1");
await api.request("/users", { method: "OPTIONS" }); // any other verb
```

**Request options.** The last argument, `requestOptions`, takes everything `fetch` does (`signal`, `cache`, `headers`, …) plus:

- `queryParams` — an object whose `null`/`undefined` values are dropped and whose arrays become repeated keys (`{ ids: [1, 2] }` → `ids=1&ids=2`), or a `URLSearchParams`. Other object values (a `Date`, a nested object) are rejected rather than sent as `[object Object]`.
- `pathParams` — values for `{name}` placeholders: `api.get("/users/{id}", { pathParams: { id } })`. Each is encoded into its own segment, so an id like `../admin` or `x?role=admin` cannot change which endpoint you call (`encodeURIComponent` alone lets `..` through); `""`, `.` and `..` are refused, as are missing or unused values. Use it instead of string interpolation. Without `pathParams`, braces are left alone.
- `meta` — settings for plugins on this call, never sent (see [Plugins](/plugins/)).
- `throwOn` — which non-ok responses reject on this call (see [Errors](/guide/errors)).

A `null` (or `undefined`) header value drops a client default for that call: `api.get("/public", { headers: { authorization: null } })`.

**URLs** are joined by string concatenation: `baseURL: "https://a/v1"` + `"/users"` → `https://a/v1/users`. The `/v1` survives, unlike with `new URL()`. A query is appended with `&` if the path already has one, and placed before any `#fragment`. Where absolute URLs may go is set on the client — see [Where requests and headers go](/guide/clients#where-requests-and-headers-go).

**Bodies.** `string`, `FormData`, `Blob`, `ArrayBuffer`/views, `URLSearchParams` and `ReadableStream` go through untouched — recognised by type tag, so polyfill and cross-realm instances count too. A `ReadableStream` is sent with `duplex: "half"`, which fetch requires. Anything else — including `null` — becomes JSON with `content-type: application/json`; a content type you set must be a JSON one. Bodies JSON would mangle — a `Map`, `Set`, generator, Node stream or function — are rejected with a `TypeError` that says what to pass instead. A `FormData` body is always sent without a `content-type` header, even with a JSON default, so the runtime can add the multipart boundary. `GET`/`HEAD` with a body is a `TypeError`.

**Methods.** `query` sends the [RFC 10008](https://www.rfc-editor.org/rfc/rfc10008) QUERY method: safe and idempotent like GET, so `retry()` repeats it by default, but the query travels in the body. Any `fetch` sends it; the server has to understand it (Node's own `http` server does from v20). `request` is the way to any other verb; its `method` autocompletes the standard ones, and those go out uppercased whatever case you write them in (fetch itself leaves `"patch"` lowercase, which servers answer with 405). Other method names are sent as written.

**Argument errors reject, they don't throw.** No `baseURL` with a relative path, a URL that does not parse (`baseURL: "api.example.com"` without `https://`), a `BigInt` in a JSON body, a missing `method` in `request` — all surface as a rejected `TypeError` before anything is sent, never as a retried `status: 0`.
