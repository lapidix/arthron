# `retry(options)`

Re-runs the attempt on a network failure or a retryable status. Because it re-runs the whole attempt, request interceptors run again — a refreshed token or a new trace id is picked up automatically.

```ts
arthron({ baseURL: API, plugins: [retry({ retries: 3, statuses: [429, 503] })] });
```

| option | default | |
|---|---|---|
| `retries` | `2` | retries after the first attempt (3 requests total); a whole number ≥ 0 |
| `statuses` | `[408, 429, 500, 502, 503, 504]` | network failures (`status: 0`) are always retried |
| `methods` | `GET HEAD OPTIONS QUERY PUT DELETE` | case-insensitive |
| `delayFn` | `(attempt) => Math.random() * 300 * 2 ** attempt` | the wait in ms; `attempt` counts from 0 (0 after the first request failed), here as in `shouldRetry` and `onRetry`. Full jitter, so clients that failed together don't retry together. Must return a finite number ≥ 0, else the call rejects with a `TypeError` |
| `maxRetryAfter` | `60_000` | a `Retry-After` longer than this means "don't retry" |
| `shouldRetry` | — | `(error, attempt, requestContext) => boolean \| undefined`: `true` retries, `false` stops, `undefined` uses the rules above. Sees every error, an inner `TimeoutError` included |
| `onRetry` | — | `(error, attempt, delay) => void`, before each wait of `delay` ms |

**Per call:** `meta: { retry: false }` turns it off, and `meta: { retry: { retries: 5 } }` overrides any option.

Honours `Retry-After` (seconds or HTTP date). Never retries a `ReadableStream` body or an aborted request, never more than `retries` times, and never past a `Retry-After` longer than `maxRetryAfter` — `shouldRetry` cannot lift those. Opting a non-idempotent method in (`methods: ["POST"]`) means a network failure is retried too, and a dropped connection may already have reached the server. Where a duplicate would hurt — a payment, an LLM completion you pay for — keep retries to statuses: `shouldRetry: (error) => (isArthronError(error) && error.status === 0 ? false : undefined)`.
