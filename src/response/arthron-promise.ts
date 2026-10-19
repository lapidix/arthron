import { cancellationError } from "../error/create-error";
import type {
  ArthronPromise,
  NdjsonOptions,
  SseOptions,
  StandardSchemaV1,
} from "../types/response.types";
import { validate } from "./schema-validation";
import { parseNdjson, parseSse } from "./stream-parser";

/** Defer the Response until iteration starts, so the helper itself never rejects. */
function iterate<T>(
  promise: Promise<Response>,
  parse: (res: Response) => AsyncGenerator<T>,
  signal: AbortSignal | null | undefined,
): AsyncIterable<T> {
  // Iteration may start long after the request fails. Mark the rejection
  // handled now; the first `next()` still rethrows it.
  promise.catch(() => {});
  return {
    async *[Symbol.asyncIterator]() {
      try {
        yield* parse(await promise);
      } catch (error) {
        throw cancellationError(error, signal);
      }
    },
  };
}

/**
 * Sugar over `Promise<Response>`: `.json()` is `(await p).json()`. Awaiting
 * without a helper still yields the untouched `Response`.
 */
export function toArthronPromise(
  promise: Promise<Response>,
  signal?: AbortSignal | null,
): ArthronPromise {
  // A body read the caller aborted rejects with their reason, whatever the
  // runtime's fetch reports.
  const read = <T>(body: (res: Response) => Promise<T>): Promise<T> =>
    promise.then(body).catch((error: unknown) => {
      throw cancellationError(error, signal);
    });
  return Object.assign(promise, {
    json: ((schema?: StandardSchemaV1) =>
      read(async (res) => {
        const data: unknown = await res.json();
        return schema ? validate(schema, data) : data;
      })) as ArthronPromise["json"],
    text: () => read((res) => res.text()),
    blob: () => read((res) => res.blob()),
    arrayBuffer: () => read((res) => res.arrayBuffer()),
    formData: () => read((res) => res.formData()),
    sse: (options?: SseOptions) =>
      iterate(promise, (res) => parseSse(res, options), signal),
    ndjson: <T = unknown>(options?: NdjsonOptions) =>
      iterate(promise, (res) => parseNdjson<T>(res, options), signal),
  });
}
