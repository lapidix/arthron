# Errors

```ts
import { isArthronError } from "arthron";

try {
  await api.get("/users/404");
} catch (e) {
  if (isArthronError(e)) {
    e.status; // 404, or 0 when the network failed
    e.payload; // the failed response's body, parsed: JSON, else text; undefined for a network failure
    e.description; // the server's description of the failure, or undefined — for people
    e.message; // arthron's own: "GET https://api.example.com/users/404 failed with 404 Not Found" — for logs
    e.response; // the failed Response, still readable (up to 64 KiB of its body)
    e.requestContext; // the RequestContext that was sent — url, init (method, headers), meta; read it directly, it is left out of logs
  }
}
```

**`message` is for logs, `description` is for people.** `message` is written by arthron — method, URL without query, status — so a log line or an error tracker says which request failed, and never carries text the server chose. `description` is the server's account of the failure: by default the payload's `message`, else `error` (a string), else `error.message`, else `detail`. It is the right thing for a toast (`e.description ?? "Something went wrong"`), but untrusted — render it as text, never as HTML, and filter it if your gateway leaks internal routes in it. For an API that puts it elsewhere, pass `extractDescription: (payload) => (payload as { msg?: string }).msg` to the client; one that throws on an unexpected body leaves `description` undefined and the error intact.

**Nothing leaks through an error.** `requestContext`, `response` and `headers` (the response's) are not enumerable, and `toJSON()` returns only name, message, description, status, statusText, method, a URL without query or userinfo, and `payload`. So `JSON.stringify(e)`, `console.error(e)` and error trackers never print your tokens. Error bodies are read up to 64 KiB — enough for any error message, and a huge or endless error body cannot fill memory; past the limit `payload` is the raw text and the rest of the body is cancelled. `isArthronError(e)` and `e instanceof ArthronError` work across copies of the package — the ESM and CJS builds loaded side by side, a CJS dependency's client caught by your ESM code.

**Not every non-ok response is a failure.** An opaque response (`mode: "no-cors"`) and the 3xx of `redirect: "manual"` come back as a `Response`, since you asked for them. `throwOn` picks which other non-ok responses reject, for the client or one call: `api.get("/maybe", { throwOn: (response) => response.status !== 404 })` returns the 404 to inspect. An ok response never rejects.

**Cancellation is not an `ArthronError`.** A request that is aborted or times out rejects with the abort reason — `AbortError` / `TimeoutError`, or whatever you passed to `abort(reason)`. So does a schema mismatch (`SchemaMismatchError`, see [Responses](/guide/responses)) and anything a plugin throws.
