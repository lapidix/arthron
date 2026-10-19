import { redactUrl } from "../request/url";
import { rebuildResponse } from "../response/rebuild-response";
import type { RequestContext } from "../types";

export type ErrorMessageResolver = (
  data: unknown,
  response: Response,
) => string | undefined;

type ArthronErrorInit = {
  message: string;
  status: number;
  statusText: string;
  headers: Headers;
  data: unknown;
  request: RequestContext;
  response?: Response;
  cause?: unknown;
};

/**
 * Marks an ArthronError across copies of this package. The ESM and CJS
 * builds can both end up loaded (a CJS dependency creates the client, ESM
 * app code catches), each with its own class — `Symbol.for` is shared.
 */
const BRAND = Symbol.for("arthron.ArthronError");

/**
 * The only error arthron itself produces. Two sources: a response with
 * `ok === false`, or fetch rejecting outright (network failure, `status` 0).
 * Everything else — cancellation, interceptor bugs — is rethrown untouched.
 */
export class ArthronError extends Error {
  override readonly name = "ArthronError";
  /** HTTP status of the failed response; `0` when fetch itself failed (network). */
  readonly status: number;
  readonly statusText: string;
  /** Response headers; empty for network failures. Not enumerable — kept out of logs. */
  declare readonly headers: Headers;
  /** Parsed body: JSON if it parses, else the text, else `undefined`. */
  readonly data: unknown;
  /**
   * The context that was sent — url and init after request interceptors.
   * Not enumerable: it holds credentials, so `JSON.stringify`, `console.error`
   * and error trackers leave it out. Read it directly when you need it.
   */
  declare readonly request: RequestContext;
  /** The failed Response, still readable — its body holds what arthron read (at most 64 KiB). Absent for network failures. Not enumerable. */
  declare readonly response: Response | undefined;
  /** The underlying error for network failures. */
  override readonly cause: unknown;

  constructor(init: ArthronErrorInit) {
    super(init.message);
    this.status = init.status;
    this.statusText = init.statusText;
    this.data = init.data;
    this.cause = init.cause;
    Object.defineProperties(this, {
      headers: { value: init.headers },
      request: { value: init.request },
      response: { value: init.response },
      [BRAND]: { value: true },
    });
  }

  /** `instanceof ArthronError` holds for an error from any copy of the package. */
  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === ArthronError
      ? isArthronError(value)
      : Function.prototype[Symbol.hasInstance].call(this, value);
  }

  /** What serializers see: no headers, no body, no query or userinfo. */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      method: this.request.init.method ?? "GET",
      url: redactUrl(this.request.url),
      data: this.data,
    };
  }
}

/** `true` for errors arthron produced: a `!ok` response or a network failure. Cancellations and plugin bugs are not ArthronErrors. */
export function isArthronError(error: unknown): error is ArthronError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { [BRAND]?: unknown })[BRAND] === true
  );
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** `message` → `error` (string) → `error.message` → `detail`. */
export function defaultErrorMessage(data: unknown): string | undefined {
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

export async function responseError(
  response: Response,
  request: RequestContext,
  resolve: ErrorMessageResolver = defaultErrorMessage,
): Promise<ArthronError> {
  const read = await readCapped(response, MAX_ERROR_BODY_BYTES);
  const data = read && parseBody(read);
  // The body was consumed above; hand the caller a Response over what was read.
  if (read) response = rebuildResponse(response, read.bytes);
  return new ArthronError({
    message:
      resolve(data, response) ??
      `Request failed with status ${response.status}`,
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
    message: cause instanceof Error ? cause.message : "Network error",
    status: 0,
    statusText: "",
    headers: new Headers(),
    data: undefined,
    request,
    cause,
  });
}
