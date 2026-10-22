# retry

`retry(options)` re-runs an attempt that failed with a network error or a retryable status.

It re-runs the whole attempt, request interceptors included. A refreshed token or a new trace id is picked up automatically.

```ts
arthron({
  baseURL: API,
  plugins: [retry({ retries: 3, statuses: [429, 503] })],
});
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `retries` | `2` | How many times to retry after the first attempt; the default makes 3 requests in all. A whole number ≥ 0. |
| `statuses` | `[408, 429, 500, 502, 503, 504]` | The statuses to retry. Network failures (`status: 0`) are retried whatever this list holds. |
| `methods` | `GET HEAD OPTIONS QUERY PUT DELETE` | The methods to retry, compared case-insensitively. |
| `delayFn` | full jitter | `(attempt) => number`: the wait in ms before the next attempt. See [Waiting between attempts](#waiting-between-attempts). |
| `maxRetryAfter` | `60_000` | A `Retry-After` longer than this means "don't retry". |
| `shouldRetry` | — | `(error, attempt, requestContext) => boolean \| undefined`: your own verdict on one failure. See [Your own verdict](#your-own-verdict). |
| `onRetry` | — | `(error, attempt, delay) => void`, called before each wait of `delay` ms. |

`attempt` counts from 0, in `delayFn`, `shouldRetry` and `onRetry` alike. It is 0 after the first request failed.

## Waiting between attempts

The default `delayFn` is "full jitter": a random wait between 0 and 300 · 2^attempt ms.

```ts
(attempt) => Math.random() * 300 * 2 ** attempt
```

Clients that failed together then don't retry together.

A `delayFn` must return a finite number ≥ 0. Anything else rejects the call with a `TypeError`.

### Retry-After

`retry` honours a `Retry-After` header, in seconds or as an HTTP date. Its wait is used instead of the one `delayFn` returns.

A `Retry-After` longer than `maxRetryAfter` means the call is not retried at all.

## Your own verdict

`shouldRetry` decides one failure:

- `true` retries.
- `false` stops.
- `undefined` leaves it to `statuses` and `methods`.

It sees every error, a `TimeoutError` from a [`timeout`](/plugins/timeout) placed after `retry` included.

It cannot lift the limits in the next section.

## What is never retried

Whatever the options and `shouldRetry` say, `retry` never:

- resends a `ReadableStream` body
- retries an aborted request
- retries more than `retries` times
- waits out a `Retry-After` longer than `maxRetryAfter`

## Per-call settings

| `meta` | Effect on this call |
| --- | --- |
| `{ retry: false }` | Turns retry off. |
| `{ retry: { retries: 5 } }` | Overrides the options it sets; the others keep the values given to `retry`. Any option can be overridden. |

```ts
api.get("/report", { meta: { retry: false } });
```

## Non-idempotent methods

Opting a non-idempotent method in, such as `methods: ["POST"]`, retries its network failures too. A dropped connection may already have reached the server.

::: warning
Where a duplicate would hurt — a payment, an LLM completion you pay for — keep retries to statuses:

```ts
retry({
  methods: ["POST"],
  shouldRetry: (error) =>
    isArthronError(error) && error.status === 0
      ? false
      : undefined,
});
```
:::
