# Errors

A call rejects with an `ArthronError` when the response is not ok or the network fails. This page covers what the error holds, what to show and what to log, and what rejects with something else.

## Catching an error

```ts
import { isArthronError } from "arthron";

try {
  await api.get("/users/404");
} catch (e) {
  if (isArthronError(e)) {
    e.status;
    e.payload;
    e.description;
    e.message;
    e.response;
    e.requestContext;
  }
}
```

| Field | What it holds |
| --- | --- |
| `status` | The response's status, such as `404`. `0` when the network failed. |
| `payload` | The failed response's body, parsed: JSON, else text. `undefined` for a network failure. |
| `description` | The server's description of the failure, or `undefined`. For people. |
| `message` | arthron's own, such as `"GET https://api.example.com/users/404 failed with 404 Not Found"`. For logs. |
| `response` | The failed `Response`, still readable (up to 64 KiB of its body). |
| `requestContext` | The `RequestContext` that was sent: `url`, `init` (method, headers) and `meta`. Read it directly; it is left out of logs. |

The whole class is under [ArthronError](#arthronerror) at the end of this page.

### Across copies of the package

`isArthronError(e)` and `e instanceof ArthronError` work across copies of the package. That covers the ESM and CJS builds loaded side by side, such as a CJS dependency's client caught by your ESM code.

## Message and description

An `ArthronError` carries two texts: `message` is for logs, `description` is for people.

### message is for logs

arthron writes `message`: the method, the URL without its query, and the status. For a network failure, the runtime's reason takes the place of the status.

A log line or an error tracker says which request failed. It never carries text the server chose.

### description is for people

`description` is the server's account of the failure. By default it is the first of these in the payload that is a string:

1. `message`
2. `error`
3. `error.message`
4. `detail`

It is the text to show a person: `e.description ?? "Something went wrong"`.

::: warning
`description` is untrusted. Render it as text, never as HTML. Filter it if your gateway leaks internal routes in it.
:::

### Reading the description from elsewhere

For an API that puts the description elsewhere, pass `extractDescription` to the client:

```ts
const api = arthron({
  baseURL: "https://api.example.com",
  extractDescription: (payload) =>
    (payload as { msg?: string }).msg,
});
```

An extractor that throws on an unexpected body leaves `description` undefined and the error intact.

## What an error includes

- `requestContext`, `response` and `headers` (the response's) are not enumerable.
- `toJSON()` returns only `name`, `message`, `description`, `status`, `statusText`, `method`, a URL without query or userinfo, and `payload`.

The URL in arthron's message omits query strings and userinfo. `payload` and `description` come from the server and are included as received, so treat them as sensitive if your API may put secrets in an error body. The built-in logger prints the redacted URL and status; its `onEvent` callback also receives the error object.

### Error bodies are capped

Error bodies are read up to 64 KiB, so a huge or endless body does not make arthron keep reading it.

Past the limit, `payload` is the truncated text and the rest of the body is cancelled.

## Responses that do not reject

Not every non-ok response is a failure. By default these come back as a `Response`, since you asked for them:

- an opaque response (`mode: "no-cors"`)
- the 3xx of `redirect: "manual"`

An ok response never rejects.

### Choosing with throwOn

`throwOn` picks which non-ok responses reject, for the client or one call. Return `false` to get the `Response` instead:

```ts
api.get("/maybe", {
  throwOn: (response) => response.status !== 404,
});
```

This returns the 404 to inspect.

A call's `throwOn` overrides the client's.

A `throwOn` you pass replaces the default, so it also decides for opaque responses and the 3xx of `redirect: "manual"`. The one above rejects them, since their status is not 404.

## What is not an ArthronError

These reject with something else:

| What happened | The call rejects with |
| --- | --- |
| The request was aborted | The abort reason: an `AbortError`, or whatever you passed to `abort(reason)` |
| The request timed out | The abort reason, a `TimeoutError` |
| The body did not match a schema | A `SchemaMismatchError`; see [Responses](/guide/responses#validating-with-a-schema) |
| A plugin threw | Whatever the plugin threw |

## ArthronError

The whole class, as `arthron` exports it:

```ts
class ArthronError extends Error {
  // the fields below, for a test or a plugin that builds one
  constructor(options: ArthronErrorOptions);
  // 0 for network failures
  status: number;
  statusText: string;
  // the response's headers; not enumerable
  headers: Headers;
  // the failed response's body, parsed (JSON, else text);
  // undefined for a network failure
  payload: unknown;
  // the server's description of the failure, extracted
  // from payload; untrusted text
  description: string | undefined;
  // absent for network failures; not enumerable
  response?: Response;
  // what plugins get as requestContext, as sent (url,
  // init.method, init.headers, meta) — not a fetch
  // Request; not enumerable, holds credentials
  requestContext: RequestContext;
  // the underlying error for network failures (query and
  // userinfo redacted)
  cause?: unknown;
  // url without query/userinfo
  toJSON(): {
    name; message; description; status;
    statusText; method; url; payload;
  };
}
```

### Types

Both come from `arthron`.

| Type | What it is |
| --- | --- |
| `ArthronErrorOptions` | What `new ArthronError(options)` takes, for a test or a plugin that builds one; each field becomes the error's field of that name |
| `DescriptionExtractor` | The type of `extractDescription`: takes the failed response's payload and the `Response`, returns the description or `undefined` |
