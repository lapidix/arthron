# In browsers

In a browser, CORS and the engine have the last word. CI runs the built package in Chromium, Firefox and WebKit against a server on another origin; this page lists what to plan for.

## CORS preflights

A JSON body, a custom header and `query()`'s QUERY method each make the browser send a preflight. The API must allow them:

| The request has | The API must answer the preflight with |
| --- | --- |
| A JSON body | `Access-Control-Allow-Headers` that lists `content-type` |
| A custom header | `Access-Control-Allow-Headers` that lists it |
| The QUERY method | `Access-Control-Allow-Methods: QUERY` |

## Retry-After

[`retry()`](/plugins/retry) reads `Retry-After` only if the API exposes it:

```http
Access-Control-Expose-Headers: retry-after
```

Otherwise it waits its own delay.

## Manual redirects

`redirect: "manual"` gives an opaque redirect: `status` 0, `type` `"opaqueredirect"`.

By default it is returned rather than thrown; see [Responses that do not reject](/guide/errors#responses-that-do-not-reject).

## Streaming request bodies

A `ReadableStream` body streams only over HTTP/2 (Chromium, WebKit). The `ArthronError` for one sent to an HTTP/1.1 server says so.

Where the browser cannot stream a request body at all, the call rejects with a `TypeError` before anything is sent. Firefox, for one, would send the text `"[object ReadableStream]"`. This check applies to the global fetch; a `fetchFn` you pass is not checked.

::: tip
Either way, send a `Blob` or `ArrayBuffer` there instead of a `ReadableStream`.
:::
