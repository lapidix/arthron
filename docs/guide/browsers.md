# In browsers

CORS and the engine have the last word. CI runs the built package in Chromium, Firefox and WebKit against a server on another origin.

- A JSON body, a custom header and `query()`'s QUERY method each make the browser send a preflight, so the API must allow them (`Access-Control-Allow-Methods: QUERY`, `Access-Control-Allow-Headers`).
- `retry()` reads `Retry-After` only if the API exposes it (`Access-Control-Expose-Headers: retry-after`); otherwise it waits its own delay.
- `redirect: "manual"` gives an opaque redirect (`status` 0, `type` `"opaqueredirect"`), returned rather than thrown.
- A `ReadableStream` body streams only over HTTP/2 (Chromium, WebKit), and the `ArthronError` for one sent to an HTTP/1.1 server says so. Where the browser cannot stream a request body at all (Firefox would send the text `"[object ReadableStream]"`), the call rejects with a `TypeError` before anything is sent. Either way, send a `Blob` or `ArrayBuffer` there.
