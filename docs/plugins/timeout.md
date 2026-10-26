# timeout

`timeout(ms)` or `timeout({ total?, idle? })` aborts a call that takes too long, or that goes quiet for too long.

It rejects with a `TimeoutError`. That is not an `ArthronError`: error interceptors skip it, and `retry` does not repeat it unless your `shouldRetry` returns `true` for it.

```ts
// 5 s for the call
arthron({ plugins: [timeout(5_000)] });
// for streams: 30 s without data
arthron({ plugins: [timeout({ idle: 30_000 })] });
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `total` | none | Ms until the body has been fully read. A server that sends headers and then stalls still trips it. |
| `idle` | none | Ms without data while arthron waits on the server: for the headers, then for the next chunk, one ahead of your reads. The time your code takes between reads does not count, so a stream that keeps flowing is never cut off. |

`timeout(ms)` is short for `timeout({ total: ms })`.

- Options with neither `total` nor `idle` are a `TypeError`.
- `Infinity` means no deadline.
- Any other deadline outside 0–2147483647 ms is a `TypeError`.

## Streams

A total deadline also cuts off a stream that is still flowing. For streams, bound the silence with `idle` instead.

Or combine both. Whichever trips first ends the call:

```ts
timeout({ total: 600_000, idle: 30_000 });
```

`idle` does not cut off a body you leave unread once its first chunk is in. Read it, cancel it with `response.body?.cancel()`, or set `total` as well.

## Where it goes in plugins

The total deadline counts from the start of what `timeout` wraps, so its place in `plugins` decides what it bounds:

```ts
// 5 s per attempt; by default a timed-out one is not retried
arthron({ plugins: [retry(), timeout(5_000)] });
// 5 s for all attempts together
arthron({ plugins: [timeout(5_000), retry()] });
```

- After `retry`, each attempt gets its own deadline. A timed-out attempt is not retried, unless `shouldRetry` returns `true` for its `TimeoutError`.
- Before `retry`, one deadline covers all attempts together.

## Per-call settings

`meta.timeout` has the same shape as `meta.retry`:

| `meta` | Effect on this call |
| --- | --- |
| `{ timeout: false }` | Lifts the deadlines. |
| `{ timeout: 120_000 }` | Replaces the total deadline. |
| `{ timeout: { idle: 60_000 } }` | Replaces the parts it sets; the others keep the values given to `timeout`. |

## Signals and timers

It combines with a `signal` you pass yourself.

Its timer never keeps a Node process alive on its own.
