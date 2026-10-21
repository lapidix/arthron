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
  extractDescription: DescriptionExtractor = defaultDescription,
): Promise<ArthronError> {
  const read = await readCapped(response, MAX_ERROR_BODY_BYTES);
  const payload = read && parseBody(read);
  // The body was consumed above; hand the caller a Response over what was read.
  if (read) response = rebuildResponse(response, read.bytes);
  const status = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
  return new ArthronError({
    // arthron's own words for logs; the server's go in `description`.
    message: `${describeRequest(request)} failed with ${status}`,
    description: extractDescription(payload, response) || undefined,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    payload,
    request,
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

export function networkError(
  cause: unknown,
  request: RequestContext,
): ArthronError {
  // Some runtimes' messages repeat the URL, query and userinfo included.
  const reason =
    cause instanceof Error && cause.message
      ? redactUrlIn(cause.message, request.url)
      : "network error";
  const hint = isReadableStream(request.init.body) ? STREAM_BODY_HINT : "";
  return new ArthronError({
    message: `${describeRequest(request)} failed: ${reason}${hint}`,
    status: 0,
    statusText: "",
    headers: new Headers(),
    payload: undefined,
    request,
    cause,
  });
}
