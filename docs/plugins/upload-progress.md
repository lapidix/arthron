# `uploadProgress()`

Reports how much of a call's body has been sent. It does nothing by itself — only a call that passes `meta.uploadProgress` reports progress, and every other call, on the same client too, goes out exactly as before.

```ts
const api = arthron({ baseURL: API, plugins: [retry(), uploadProgress()] }); // last in plugins

await api.get("/me"); // as usual
await api.post("/files", file, {
  meta: { uploadProgress: { onProgress: ({ fraction }) => setBar(fraction) } }, // this call only
});
```

| event field | |
|---|---|
| `loaded` | bytes sent |
| `total` | bytes in the body; `undefined` when unknown — a stream without `content-length` |
| `fraction` | `loaded / total`, from 0 to 1 — not a percentage; `undefined` with `total` |

**Per call:** `meta: { uploadProgress: { onProgress } }`, only on calls that want progress. Progress counts what was handed to the network, so it reaches 1 a moment before the server has it all; the response arriving is the end. Each attempt counts from 0 again, so a retried upload starts the bar over.

How that call is sent depends on where it runs:

- **Browser:** over `XMLHttpRequest`, the only browser API that reports upload progress. On another origin, the upload listener makes every such call send a CORS preflight — an S3 bucket's CORS rules must allow the method and headers. The response arrives whole: `.sse()` / `.ndjson()` are not live on that call. What XHR cannot honour and would change the call is refused with a `TypeError` before sending: `redirect: "manual" | "error"`, `mode: "no-cors"`, `credentials: "omit"` to the page's own origin (XHR always sends its cookies there), a `referrerPolicy` or `referrer` of its own (XHR sends the page's referrer) and `integrity` (XHR cannot check it). What only tunes fetch — `cache`, `priority`, `keepalive` — is ignored on that call. A `ReadableStream` body is sent as usual, without progress.
- **Node:** with `fetch` as usual, the body counted as it is read, in steps of at most 64 KiB. `content-length` and the content type a `Blob` would set are kept, so an S3 presigned `PUT` accepts it. A `FormData` body is encoded with its length known up front, its files streamed rather than read into memory. jsdom on Node counts the same way.
- **Anywhere else** — Deno, Bun, Cloudflare Workers, an Electron main process, a service worker — and on a client with its own `fetchFn`, or with another plugin's: sent as usual, without progress.

An `onProgress` that throws fails the call with its own error, untouched: not an `ArthronError`, not retried. Put `uploadProgress()` last in `plugins`: a request interceptor after it that replaces `init.signal` would cut that path, and the error would come back as a network failure.
