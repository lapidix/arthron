import { isReadableStream } from "../request/body";
import { redactUrl, redactUrlIn } from "../request/url";
import { rebuildResponse } from "../response/rebuild-response";
import type { RequestContext } from "../types/request.types";
import type { DescriptionExtractor } from "../types/response.types";
import { ArthronError } from "./arthron-error";

/**
 * Cancellation is not an HTTP failure. Matched by name so it works across
 * realms — or by the request's own `signal`, since `abort(reason)` rejects
 * with whatever reason the caller chose.
 */
export function isCancellation(
  error: unknown,
  signal?: AbortSignal | null,
): boolean {
  if (signal?.aborted) return true;
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * What a cancelled call rejects with: its signal's reason. WebKit's fetch
 * rejects, and errors a half-read body, with a generic AbortError instead,
 * dropping a TimeoutError or the caller's own reason.
 */
export function cancellationError(
  error: unknown,
  signal?: AbortSignal | null,
): unknown {
  return signal?.aborted ? signal.reason : error;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** `message` → `error` (string) → `error.message` → `detail`. */
export function defaultDescription(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  if (typeof payload.detail === "string") return payload.detail;
  return undefined;
}

/** How much of an error body arthron reads. Error bodies are for diagnosis; a hostile or broken server must not be able to fill memory with one. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/** Up to `limit` bytes of the body; the rest is cancelled unread. `undefined` when there is no body or reading it failed. */
async function readCapped(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; truncated: boolean } | undefined> {
  if (!response.body) return undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    // Inside the try: a body that is already locked or used counts as unreadable.
    reader = response.body.getReader();
    while (size <= limit) {
      const { value, done } = await reader.read();
      if (done) break;
      // A custom fetch may deliver more than the limit in one chunk. Keep
      // only its prefix instead of allocating another buffer of that size.
      chunks.push(value.subarray(0, Math.max(0, limit - size)));
      size += value.byteLength;
    }
  } catch {
    return undefined;
  } finally {
    // A stream's cancel promise may never settle (notably when another tee
    // branch is still open). Request cancellation, but do not hold the error
    // behind cleanup controlled by the body producer.
    void reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return size > limit
    ? { bytes: bytes.subarray(0, limit), truncated: true }
    : { bytes, truncated: false };
}

/** JSON if the whole body parses, else the text (cut at the limit), else `undefined` when empty. */
function parseBody(read: {
  bytes: Uint8Array<ArrayBuffer>;
  truncated: boolean;
}): unknown {
  const text = new TextDecoder().decode(read.bytes);
  if (text === "") return undefined;
  if (read.truncated) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The request as error messages name it: method and URL, no query or userinfo. */
function describeRequest(requestContext: RequestContext): string {
  return `${requestContext.init.method ?? "GET"} ${redactUrl(requestContext.url)}`;
}

export async function responseError(
  response: Response,
  requestContext: RequestContext,
  extractDescription: DescriptionExtractor = defaultDescription,
): Promise<ArthronError> {
  const read = await readCapped(response, MAX_ERROR_BODY_BYTES);
  const payload = read && parseBody(read);
  // The body was consumed above; hand the caller a Response over what was read.
  if (read) response = rebuildResponse(response, read.bytes);
  const status = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
  let description: string | undefined;
  try {
    description = extractDescription(payload, response) || undefined;
  } catch {
    // An extractor written for the API's JSON, handed a gateway's HTML page:
    // the failure stays an ArthronError — status, retry and error
    // interceptors intact — just without a description.
  }
  return new ArthronError({
    // arthron's own words for logs; the server's go in `description`.
    message: `${describeRequest(requestContext)} failed with ${status}`,
    description,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    payload,
    requestContext,
    response,
  });
}

/**
 * Browsers that stream a request body (Chromium, current WebKit) do it only
 * over HTTP/2, and fail one sent to an HTTP/1.1 server with the same bare
 * "Failed to fetch" / "Load failed" as a dead server, so name the likely cause.
 */
const STREAM_BODY_HINT =
  " — in a browser, a ReadableStream body streams only over HTTP/2; send a Blob or ArrayBuffer to an HTTP/1.1 server";

/** `error[key]`, or `undefined` if reading it throws. */
function readField(error: object, key: PropertyKey): unknown {
  try {
    return (error as Record<PropertyKey, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * An error that cannot be changed, copied with its prototype and own fields
 * so the copy can be. Values are read through the original: V8's own
 * `stack` accessor reads nothing on another object, and DOMException's
 * `name`, `message` and `code` getters throw on one.
 */
function copyError(error: object): object {
  const descriptors: Record<PropertyKey, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(error);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key] as PropertyDescriptor;
    descriptors[key] =
      descriptor.get || descriptor.set
        ? {
            value: readField(error, key),
            enumerable: descriptor.enumerable ?? false,
            configurable: true,
          }
        : { ...descriptor, configurable: true };
  }
  for (const key of ["name", "message", "stack", "code"]) {
    if (Object.hasOwn(descriptors, key)) continue;
    const value = readField(error, key);
    if (value !== undefined) descriptors[key] = { value, configurable: true };
  }
  return Object.create(Object.getPrototypeOf(error), descriptors);
}

/**
 * Take `url`'s query and userinfo out of an error the runtime threw, in
 * place when possible: its message and stack, string fields (Node's
 * `input`), and its causes. An immutable error is copied with its prototype
 * and fields so it cannot put the full URL back into logs via `cause`.
 */
export function redactErrorUrl(
  error: unknown,
  url: string,
  seen = new Map<object, object>(),
): unknown {
  if (typeof error === "string") return redactUrlIn(error, url);
  if (typeof error !== "object" || error === null) return error;
  if (seen.has(error)) return seen.get(error);
  const fields = error as Record<string, unknown>;
  let safe = error;
  const changes = new Map<string, unknown>();
  for (const key of new Set(["message", "stack", ...Object.keys(error)])) {
    const value = fields[key];
    if (typeof value !== "string") continue;
    const redacted = redactUrlIn(value, url);
    if (redacted === value) continue;
    changes.set(key, redacted);
    if (safe === error) {
      try {
        Object.defineProperty(error, key, { value: redacted });
      } catch {
        // Frozen, or this field is read-only: redact a copy below. Fields
        // redacted before this one stay redacted on the original as well.
        safe = copyError(error);
      }
    }
  }
  seen.set(error, safe);
  if (safe !== error) {
    for (const [key, value] of changes) {
      Object.defineProperty(safe, key, { value, configurable: true });
    }
  }
  const cause = fields.cause;
  const safeCause = redactErrorUrl(cause, url, seen);
  if (safeCause !== cause) {
    try {
      Object.defineProperty(safe, "cause", { value: safeCause });
    } catch {
      // A read-only cause can live on an otherwise mutable error.
      safe = copyError(safe);
      Object.defineProperty(safe, "cause", { value: safeCause });
      seen.set(error, safe);
    }
  }
  return safe;
}

export function networkError(
  cause: unknown,
  requestContext: RequestContext,
): ArthronError {
  // Some runtimes' messages repeat the URL, query and userinfo included.
  const safeCause = redactErrorUrl(cause, requestContext.url);
  const reason =
    safeCause instanceof Error && safeCause.message
      ? safeCause.message
      : "network error";
  const hint = isReadableStream(requestContext.init.body)
    ? STREAM_BODY_HINT
    : "";
  return new ArthronError({
    message: `${describeRequest(requestContext)} failed: ${reason}${hint}`,
    status: 0,
    statusText: "",
    headers: new Headers(),
    payload: undefined,
    requestContext,
    cause: safeCause,
  });
}
