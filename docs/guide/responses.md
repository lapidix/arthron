# Responses

Every call returns a `Promise<Response>` with body helpers attached. Await it for the `Response` itself, or call a helper to read the body, check it against a schema or iterate a stream.

## Body helpers

```ts
// The Response: status, headers and body untouched
const response = await api.get("/me");

const user = await api.get("/me").json<User>();
const text = await api.get("/robots.txt").text();
const blob = await api.get("/export").blob();

// The body as a ReadableStream
const stream = (await api.post("/chat", prompt)).body;
```

| Helper | What it gives you |
| --- | --- |
| `.json<T>()` | The body parsed as JSON. `T` is a cast, not validation. |
| `.json(schema)` | The body parsed and validated, typed from the schema. See [Validating with a schema](#validating-with-a-schema). |
| `.text()` | The body as a string. |
| `.blob()` | The body as a `Blob`. |
| `.arrayBuffer()` | The body as an `ArrayBuffer`. |
| `.formData()` | The body as `FormData`. |
| `.sse()` | Server-sent events, one per `for await` step. See [Streams](#streams). |
| `.ndjson<T>()` | One parsed JSON value per line. See [Streams](#streams). |

## Validating with a schema

```ts
const user = await api.get("/me").json(UserSchema);
```

`.json(schema)` takes any [Standard Schema](https://standardschema.dev). Zod, Valibot, ArkType and others work, passed as they are.

It validates the body with the schema and resolves with the schema's output, transforms included. The result is typed from the schema.

arthron stays dependency-free. The schema library is yours.

### The ArthronSchema type

The schema's type is `ArthronSchema`.

| Type | What it is |
| --- | --- |
| `ArthronSchema` | `StandardSchemaV1` from `@standard-schema/spec`, under arthron's name |
| `ArthronSchema.Infer<S>` | The output type of the schema `S` |
| `ArthronSchema.Issue` | One problem the schema found |
| `ArthronSchema.ValidationResult` | What a schema's `validate` returns: the value, or the issues |

### When the body does not match

A body that does not match rejects with a `SchemaMismatchError`. Its `issues` list each problem and its path.

It is not an `ArthronError`: the request worked, the data did not.

## Streams

`.sse()` and `.ndjson()` read the body as it arrives, one item per `for await` step.

### Server-sent events

```ts
const events = api.post("/v1/chat/completions", body).sse();

for await (const { type, data } of events) {
  // provider sentinel; arthron does not interpret it
  if (data === "[DONE]") break;
  process.stdout.write(
    JSON.parse(data).choices[0].delta.content ?? "",
  );
}
```

`.sse()` parses `text/event-stream` the way the EventSource spec does:

- Multi-line `data:` is joined with `\n`.
- Comments are ignored.
- A blank line dispatches the event.
- An event the stream ends inside is dropped.
- `lastEventId` is carried across events.
- `retry:` is accepted as digits only, and carried on as `reconnectionTime` (ms).

### Event fields

Each event has the names a browser `MessageEvent` uses, plus `id`:

| Field | What it holds |
| --- | --- |
| `type` | The `event:` field, or `"message"` when there is none. |
| `data` | The event's `data:` lines, joined with `\n`. |
| `lastEventId` | The last event ID so far, carried across events. |
| `id` | The event's own `id:` field, when it had one. |
| `reconnectionTime` | The last `retry:` value, in ms. |

### Resuming a stream

`.sse()` does not reconnect. To resume, send `headers: { "last-event-id": e.lastEventId }` on a new request, where `e` is the last event you got.

### Newline-delimited JSON

Ollama and many log endpoints stream newline-delimited JSON:

```ts
for await (const row of api.get("/logs").ndjson<LogRow>()) {
  console.log(row);
}
```

Blank lines are skipped. A line that is not valid JSON rejects the loop with the `SyntaxError` from `JSON.parse`.

### Cancelling and leaving early

Both helpers honour `signal` and [`timeout()`](/plugins/timeout) while the body is being read.

Leaving the loop early closes the connection. That includes `break`, `return` and a throw.

### Limits

A stream is untrusted input, so both helpers have limits:

| Option | Applies to | Default | What it limits |
| --- | --- | --- | --- |
| `maxLineLength` | `.sse()` and `.ndjson()` | 8 Mi characters | One line |
| `maxDataLength` | `.sse()` | 8 Mi characters | The `data` of one event |

Going over a limit rejects the loop with a `RangeError` and closes the connection.

Raise them per call if you expect bigger payloads:

```ts
api.post("/chat", prompt).sse({
  maxDataLength: 32 * 1024 * 1024,
});
```

## Types

All five come from `arthron`.

| Type | What it is |
| --- | --- |
| `ResponsePromise` | What every request method returns: a `Promise<Response>` with the body helpers |
| `SseEvent` | One event from `.sse()`; its fields are under [Event fields](#event-fields) |
| `SseOptions` | What `.sse()` takes; see [Limits](#limits) |
| `NdjsonOptions` | What `.ndjson()` takes; see [Limits](#limits) |
| `ArthronSchema` | What `.json(schema)` takes, with `.Infer`, `.Issue` and `.ValidationResult`; see [The ArthronSchema type](#the-arthronschema-type) |
