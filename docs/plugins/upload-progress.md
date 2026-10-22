# uploadProgress

`uploadProgress()` reports how much of a call's body has been sent.

It does nothing by itself. Only a call that passes `meta.uploadProgress` reports progress. Every other call, on the same client too, goes out exactly as before.

```ts
const api = arthron({
  baseURL: API,
  // uploadProgress() last in plugins
  plugins: [retry(), uploadProgress()],
});

// as usual
await api.get("/me");
// this call only
await api.post("/files", file, {
  meta: {
    uploadProgress: {
      onProgress: ({ fraction }) => setBar(fraction),
    },
  },
});
```

## Per-call settings

Pass `meta: { uploadProgress: { onProgress } }`, only on the calls that want progress.

## Progress events

`onProgress` receives:

| Field | What it holds |
| --- | --- |
| `loaded` | Bytes sent. |
| `total` | Bytes in the body; `undefined` when unknown, such as a stream without `content-length`. |
| `fraction` | `loaded / total`, from 0 to 1 — not a percentage. `undefined` when `total` is. |

## What progress counts

Progress counts what was handed to the network. It reaches 1 a moment before the server has it all; the response arriving is the end.

Each attempt counts from 0 again, so a retried upload starts the bar over.

## How the call is sent

How a call with progress is sent depends on where it runs.

### Browser

The call goes over `XMLHttpRequest`, the only browser API that reports upload progress.

- On another origin, the upload listener makes every such call send a CORS preflight. An S3 bucket's CORS rules must allow the method and headers.
- The response arrives whole: `.sse()` and `.ndjson()` are not live on that call.
- `cache`, `priority` and `keepalive` only tune fetch, so they are ignored on that call.
- A `ReadableStream` body is sent as usual, without progress.

What XHR cannot honour, and would change the call, is refused with a `TypeError` before sending:

| Request option | Why it is refused |
| --- | --- |
| `redirect: "manual"` or `"error"` | XHR always follows redirects. |
| `mode: "no-cors"` | XHR has no no-cors mode. |
| `credentials: "omit"` to the page's own origin | XHR always sends its cookies there. |
| a `referrerPolicy` or `referrer` of its own | XHR sends the page's referrer. |
| `integrity` | XHR cannot check it. |

### Node

The call is sent with `fetch` as usual, and the body is counted as it is read.

- Progress comes in steps of at most 64 KiB.
- `content-length` and the content type a `Blob` would set are kept, so an S3 presigned `PUT` accepts it.
- A `FormData` body is encoded with its length known up front. Its files are streamed rather than read into memory.

jsdom on Node counts the same way.

### Everywhere else

Deno, Bun, Cloudflare Workers, an Electron main process, a service worker: the call is sent as usual, without progress.

The same goes for a client with its own `fetchFn`, or a call whose `fetchFn` another plugin set.

## When onProgress throws

An `onProgress` that throws fails the call with its own error, untouched. It is not an `ArthronError`, and it is not retried.

::: warning
Put `uploadProgress()` last in `plugins`. A request interceptor after it that replaces `init.signal` would cut the path a throwing `onProgress` takes, and its error would come back as a network failure.
:::
