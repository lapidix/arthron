export interface ArthronPromise extends Promise<Response> {
  /** The body as JSON. `T` is a cast — nothing checks it. */
  json<T = unknown>(): Promise<T>;
  /**
   * The body as JSON, validated by a Standard Schema (Zod, Valibot, ArkType…)
   * and typed by it. A mismatch rejects with a `SchemaError`.
   */
  json<S extends StandardSchemaV1>(schema: S): Promise<InferOutput<S>>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
  /** Iterate a `text/event-stream` body as events. */
  sse(options?: SseOptions): AsyncIterable<SseEvent>;
  /** Iterate a newline-delimited JSON body, one parsed value per line. */
  ndjson<T = unknown>(options?: NdjsonOptions): AsyncIterable<T>;
}

/** One server-sent event, as described by the WHATWG EventSource spec. */
export type SseEvent = {
  /** The `event:` field, when the server sent one. */
  event?: string;
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
  /** The reconnection time in ms the server last set with `retry:`; carried on every event after it. */
  retry?: number;
};

export type NdjsonOptions = {
  /**
   * Longest line accepted, in characters. A longer one rejects the iteration
   * with a RangeError and cancels the body. Default 8 Mi.
   */
  maxLineLength?: number;
};

export type SseOptions = NdjsonOptions & {
  /**
   * Most `data` one event may collect before its blank line, in characters.
   * More rejects the iteration with a RangeError and cancels the body.
   * Default 8 Mi.
   */
  maxEventSize?: number;
};

/**
 * The Standard Schema interface (https://standardschema.dev), vendored as
 * types only so arthron keeps zero dependencies. Zod, Valibot, ArkType and
 * others implement it, so their schemas can be passed to `.json(schema)`.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => SchemaResult<Output> | Promise<SchemaResult<Output>>;
    readonly types?:
      | { readonly input: Input; readonly output: Output }
      | undefined;
  };
}

export type SchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly SchemaIssue[] };

export interface SchemaIssue {
  readonly message: string;
  readonly path?:
    | readonly (PropertyKey | { readonly key: PropertyKey })[]
    | undefined;
}

/** The type a schema produces. */
export type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];

export type ErrorDetailResolver = (
  data: unknown,
  response: Response,
) => string | undefined;
