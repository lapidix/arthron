# How a call flows

```text
api.get(path, requestOptions)
  │  fill pathParams · join baseURL + path + queryParams
  │  check the origin (baseURL / allowedOrigins) · merge headers · serialize the body
  ▼
middleware[0] → middleware[1] → …                once per call, outermost first
  │  next(requestContext)                        a middleware may call it again (retry)
  ▼
attempt ─ request interceptors → fetchFn(url, init)
  ├─ ok, or let through by throwOn → response interceptors → Response
  ├─ !ok, or the network failed    → ArthronError → error interceptors → thrown
  └─ cancelled, or a plugin threw  → passed through untouched
  ▲
middleware resumes after `await next(…)`, last one first
  ▼
ResponsePromise ─ await → Response · .json() .text() .sse() .ndjson()
```

1. **Before the plugins.** The URL is built, its origin checked, the client's and the call's headers merged and the body serialized. A mistake here — no `baseURL`, a body JSON would mangle, an origin the client may not call — is a rejected `TypeError`, and no plugin runs.
2. **Middleware** wraps the whole call, outermost first. It is called once; `await next(requestContext)` runs everything below it and resumes with the result, or the error to `catch`. A middleware may call `next` again — that is a retry — or not at all.
3. **An attempt** is one trip to the network: request interceptors, then `fetchFn`, then response or error interceptors. A retry runs the whole attempt again, so a refreshed token or a new trace id is picked up without extra code, and each attempt starts from a fresh copy of the context.
4. **Where errors come from.** Only a non-ok response (unless `throwOn` lets it through) and a failed `fetch` become an `ArthronError`, and only those reach error interceptors. Cancellation and exceptions thrown by plugins pass through untouched.
5. **What you get back.** The middleware unwinds, last one first, and the call resolves with the `Response` — untouched unless a response interceptor returned a new one. The body helpers sit on top of that promise.
