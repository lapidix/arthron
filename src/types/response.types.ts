export interface ResponsePromise extends Promise<Response> {
  /** The body as JSON. `T` is a cast — nothing checks it. */
  json<T = unknown>(): Promise<T>;
  /**
   * The body as JSON, checked by a schema from Zod, Valibot, ArkType or any
   * other Standard Schema library — passed as is — and typed by it. A body
   * that does not match rejects with a `SchemaMismatchError`.
   */
  json<S extends ArthronSchema>(schema: S): Promise<ArthronSchema.Infer<S>>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
  /** Iterate a `text/event-stream` body as events. */
  sse(options?: SseOptions): AsyncIterable<SseEvent>;
  /** Iterate a newline-delimited JSON body, one parsed value per line. */
  ndjson<T = unknown>(options?: NdjsonOptions): AsyncIterable<T>;
}

/**
 * One server-sent event, as described by the WHATWG EventSource spec, with
 * the names a browser `MessageEvent` uses (`type`, `data`, `lastEventId`).
 */
export type SseEvent = {
  /**
   * The `event:` field; `"message"` when the server sent none, as in a
   * browser. Any other value is the server's own name (`"update"`,
   * `"content_block_delta"`, …).
   */
  type: "message" | (string & {});
  /** All `data:` lines of the block, joined with `\n`. */
  data: string;
  /** The `id:` field of this event's own block, when it had one. */
  id?: string;
  /**
   * The last event ID so far, as EventSource's `lastEventId`: it persists
   * across events (a block with only `id:` updates it too) and is "" until
   * the server sends one. Send it as `Last-Event-ID` to resume a stream.
   */
  lastEventId: string;
  /**
   * How long in ms the server asked a client to wait before reconnecting,
   * from its last `retry:` field (the spec's "reconnection time"); carried
   * on every event after it.
   */
  reconnectionTime?: number;
};

export type NdjsonOptions = {
  /**
   * Longest line accepted, in characters. A longer one rejects the iteration
   * with a RangeError and cancels the body. Default 8 Mi.
   */
  maxLineLength?: number;
};

export type SseOptions = {
  /**
   * Longest line accepted, in characters. A longer one rejects the iteration
   * with a RangeError and cancels the body. Default 8 Mi.
   */
  maxLineLength?: number;
  /**
   * Longest `data` one event may collect before its blank line, in
   * characters. More rejects the iteration with a RangeError and cancels the
   * body. Default 8 Mi.
   */
  maxDataLength?: number;
};

/**
 * A schema `.json(schema)` checks the body against. It is `StandardSchemaV1`
 * from `@standard-schema/spec` (https://standardschema.dev) under arthron's
 * name, copied as types so arthron keeps zero dependencies: pass a Zod,
 * Valibot, ArkType or any other Standard Schema as is — there is no
 * arthron-specific format.
 */
export interface ArthronSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | ArthronSchema.ValidationResult<Output>
      | Promise<ArthronSchema.ValidationResult<Output>>;
    readonly types?:
      | { readonly input: Input; readonly output: Output }
      | undefined;
  };
}

export declare namespace ArthronSchema {
  /** The type a schema produces — what `.json(schema)` resolves with. */
  type Infer<S extends ArthronSchema> = NonNullable<
    S["~standard"]["types"]
  >["output"];
  /** One way the body does not match, with the path to it (`StandardSchemaV1.Issue`). */
  interface Issue {
    readonly message: string;
    readonly path?:
      | readonly (PropertyKey | { readonly key: PropertyKey })[]
      | undefined;
  }
  /** What a schema's `validate` returns: the value, or the issues (`StandardSchemaV1.Result`). */
  type ValidationResult<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: readonly Issue[] };
}

/**
 * Extracts `ArthronError.description` from a failed response's payload
 * (parsed: JSON if it parses, else the text).
 */
export type DescriptionExtractor = (
  payload: unknown,
  response: Response,
) => string | undefined;
