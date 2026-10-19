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
): AsyncIterable<T> {
  // Iteration may start long after the request fails. Mark the rejection
  // handled now; the first `next()` still rethrows it.
  promise.catch(() => {});
  return {
    async *[Symbol.asyncIterator]() {
      yield* parse(await promise);
    },
  };
}

/**
 * Sugar over `Promise<Response>`: `.json()` is `(await p).json()`. Awaiting
 * without a helper still yields the untouched `Response`.
 */
export function toArthronPromise(promise: Promise<Response>): ArthronPromise {
  return Object.assign(promise, {
    json: ((schema?: StandardSchemaV1) =>
      promise.then(async (res) => {
        const data: unknown = await res.json();
        return schema ? validate(schema, data) : data;
      })) as ArthronPromise["json"],
    text: () => promise.then((res) => res.text()),
    blob: () => promise.then((res) => res.blob()),
    arrayBuffer: () => promise.then((res) => res.arrayBuffer()),
    formData: () => promise.then((res) => res.formData()),
    sse: (options?: SseOptions) =>
      iterate(promise, (res) => parseSse(res, options)),
    ndjson: <T = unknown>(options?: NdjsonOptions) =>
      iterate(promise, (res) => parseNdjson<T>(res, options)),
  });
}
