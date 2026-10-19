import type { InferOutput, StandardSchemaV1 } from "./schema.types";
import type { NdjsonOptions, SseEvent, SseOptions } from "./stream.types";

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
