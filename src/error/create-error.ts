import { redactUrl } from "../request/url";
import { rebuildResponse } from "../response/rebuild-response";
import type { RequestContext } from "../types/request.types";
import type { ErrorDetailResolver } from "../types/response.types";
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
export function defaultErrorDetail(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  if (isRecord(data.error) && typeof data.error.message === "string") {
    return data.error.message;
  }
  if (typeof data.detail === "string") return data.detail;
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
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return undefined;
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(size);
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
function describeRequest(request: RequestContext): string {
  return `${request.init.method ?? "GET"} ${redactUrl(request.url)}`;
}

export async function responseError(
  response: Response,
  request: RequestContext,
  resolve: ErrorDetailResolver = defaultErrorDetail,
): Promise<ArthronError> {
  const read = await readCapped(response, MAX_ERROR_BODY_BYTES);
  const data = read && parseBody(read);
  // The body was consumed above; hand the caller a Response over what was read.
  if (read) response = rebuildResponse(response, read.bytes);
  const status = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
  return new ArthronError({
    // arthron's own words for logs; the server's go in `detail`.
    message: `${describeRequest(request)} failed with ${status}`,
    detail: resolve(data, response) || undefined,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    data,
    request,
    response,
  });
}

export function networkError(
  cause: unknown,
  request: RequestContext,
): ArthronError {
  return new ArthronError({
    message: `${describeRequest(request)} failed: ${
      cause instanceof Error && cause.message ? cause.message : "network error"
    }`,
    status: 0,
    statusText: "",
    headers: new Headers(),
    data: undefined,
    request,
    cause,
  });
}
