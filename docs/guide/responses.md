# Responses

Each call returns `Promise<Response>` with body helpers attached:

```ts
const response = await api.get("/me"); // Response — status, headers, body untouched
const user = await api.get("/me").json<User>(); // body parsed; T is a cast, not validation
const safe = await api.get("/me").json(UserSchema); // validated by any Standard Schema (Zod, Valibot, ArkType); typed from it
const text = await api.get("/robots.txt").text();
const blob = await api.get("/export").blob();
const stream = (await api.post("/chat", prompt)).body; // ReadableStream
```

**Validating with a schema.** `.json(schema)` takes any [Standard Schema](https://standardschema.dev) — Zod, Valibot, ArkType and others, passed as is — validates the body with it, and resolves with the schema's output (transforms included). Its type is `ArthronSchema`: `StandardSchemaV1` from `@standard-schema/spec` under arthron's name, with `ArthronSchema.Infer<S>` for the output type and `ArthronSchema.Issue` for one problem. A body that does not match rejects with a `SchemaMismatchError` whose `issues` list each problem and its path. It is not an `ArthronError`: the request worked, the data did not. arthron stays dependency-free; the schema library is yours.

**Streams.**

```ts
// Server-sent events — one event per `for await` step
for await (const { type, data } of api.post("/v1/chat/completions", body).sse()) {
  if (data === "[DONE]") break; // provider sentinel; arthron does not interpret it
  process.stdout.write(JSON.parse(data).choices[0].delta.content ?? "");
}

// Newline-delimited JSON (Ollama, many log endpoints)
for await (const row of api.get("/logs").ndjson<LogRow>()) console.log(row);
```

`.sse()` parses `text/event-stream` the way the EventSource spec does: multi-line `data:` joined with `\n`, comments ignored, dispatch on a blank line, an event the stream ends inside dropped, `lastEventId` carried across events, `retry:` accepted as digits only and carried on as `reconnectionTime` (ms). Each event has the names a browser `MessageEvent` uses: `type` (the `event:` field, `"message"` when there is none), `data`, `lastEventId`, plus `id`. It does not reconnect — to resume, send `headers: { "last-event-id": e.lastEventId }` on a new request. Both helpers honour `signal` and `timeout` while the body is being read, and leaving the loop early (`break`, `return`, a throw) closes the connection.

A stream is untrusted input, so both helpers have limits: a line longer than `maxLineLength` (default 8 Mi characters), or an SSE event whose `data` outgrows `maxDataLength` (default 8 Mi characters), rejects the loop with a `RangeError` and closes the connection. Raise them per call if you expect bigger payloads: `.sse({ maxDataLength: 32 * 1024 * 1024 })`.
