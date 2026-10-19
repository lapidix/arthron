import type { ArthronPromise } from "./types";

/**
 * Sugar over `Promise<Response>`: `.json()` is `(await p).json()`. Awaiting
 * without a helper still yields the untouched `Response`.
 */
export function toArthronPromise(promise: Promise<Response>): ArthronPromise {
  return Object.assign(promise, {
    json: <T = unknown>() => promise.then((res) => res.json() as Promise<T>),
    text: () => promise.then((res) => res.text()),
    blob: () => promise.then((res) => res.blob()),
    arrayBuffer: () => promise.then((res) => res.arrayBuffer()),
    formData: () => promise.then((res) => res.formData()),
  });
}
