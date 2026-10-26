# logging

`logging(options)` logs one line when a call starts and another on success or failure, with the status and the total time, retries included. A failure without a status, such as a plugin's own error, shows the error's name in its place. Cancellation has no ending line.

```text
[arthron] → GET https://api.example.com/users
[arthron] ← GET https://api.example.com/users 200 42ms
[arthron] ✕ GET https://api.example.com/users 503 1203ms
```

```ts
const isDev = process.env.NODE_ENV !== "production";

arthron({
  baseURL: API,
  plugins: [logging({ enabled: isDev }), retry()],
});
```

::: tip
Put `logging()` first in `plugins`. It then wraps `retry()` and logs each call once, its time including retries. Placed after `retry()`, it logs every attempt on its own.
:::

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Turns logging on or off. Pass `process.env.NODE_ENV !== "production"` or similar: arthron never reads env. |
| `logger` | `console` | Where the lines go: anything with `log` and `error`. A failed call goes to `error`, the rest to `log`. |
| `onEvent` | — | Receives each event as an object, instead of console lines. |
| `timeouts` | `false` | `true` reports a call that timed out before its response arrived (a `TimeoutError`, from `timeout()` or `AbortSignal.timeout()`) as an error, with no status. Its line reads `TimeoutError` where the status goes. |

## Events

With `onEvent`, you get the events instead of the lines:

```ts
logging({
  onEvent: (event) => myLogger.info(event),
});
```

| Field | What it holds |
| --- | --- |
| `phase` | `"start"`, `"success"` or `"error"`. |
| `method` | The request method. |
| `url` | The request URL, without its query or userinfo. |
| `status` | The response status. On `"error"`, the `ArthronError`'s status (`0` for a network failure), or `undefined` for any other error. Not on `"start"`. |
| `duration` | Ms since the call started. Not on `"start"`. |
| `error` | What the call threw. Only on `"error"`. |

## What is not logged

- Query strings and `user:pass@` are never printed.
- A cancelled call logs its start but no success or error event. A `TimeoutError` counts as a cancellation unless you pass `timeouts: true`.
- A timeout while you read the body is not an error event. The call logged its success when the response arrived, and the timeout rejects your read.

## Per-call settings

`logging` has no per-call setting.
