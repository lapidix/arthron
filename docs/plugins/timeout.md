# `timeout(ms)` / `timeout({ total?, idle? })`

Aborts a call that takes too long, or goes quiet for too long. Rejects with a `TimeoutError`, which `retry` and error interceptors ignore.

```ts
arthron({ plugins: [retry(), timeout(5_000)] }); // 5 s per attempt — a timed-out attempt is not retried
arthron({ plugins: [timeout(5_000), retry()] }); // 5 s for all attempts together
arthron({ plugins: [timeout({ idle: 30_000 })] }); // for streams: 30 s without data
```

| option | default | |
|---|---|---|
| `total` | none | ms from the start of the attempt until the body has been fully read — a server that sends headers and then stalls still trips it. `timeout(ms)` is `timeout({ total: ms })` |
| `idle` | none | ms without data — while waiting for the headers and between chunks. A stream that keeps flowing is never cut off |

**Per call:** `meta: { timeout: false }` lifts the deadlines, `meta: { timeout: 120_000 }` replaces the total one, and `meta: { timeout: { idle: 60_000 } }` replaces the parts it sets — the same shape as `meta.retry`.

A total deadline also cuts off a stream that is still flowing; for streams, bound the silence with `idle` instead, or combine both: `timeout({ total: 600_000, idle: 30_000 })`, whichever trips first. Options with neither are a `TypeError`. `Infinity` means no deadline. It combines with a `signal` you pass yourself, and its timer never keeps a Node process alive on its own.
