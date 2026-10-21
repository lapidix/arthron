# `logging(options)`

One line when a call starts and one when it ends, with the status and the total time, retries included.

```
[arthron] → GET https://api.example.com/users
[arthron] ← GET https://api.example.com/users 200 42ms
[arthron] ✕ GET https://api.example.com/users 503 1203ms
```

| option | default | |
|---|---|---|
| `enabled` | `true` | pass `process.env.NODE_ENV !== "production"` or similar — arthron never reads env |
| `logger` | `console` | anything with `log` and `error` |
| `onEvent` | — | receive `{ phase, method, url, status, duration, error }` instead of console lines: `url` without query or userinfo, `duration` in ms |

**Per call:** —. Query strings and `user:pass@` are never printed. Cancellations are not logged.
