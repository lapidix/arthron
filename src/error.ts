import type { RequestContext } from "./types";
import { redactUrl } from "./url";

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
  /** The original Response, still readable (the body was parsed from a clone). Absent for network failures. Not enumerable. */
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
    });
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
  return error instanceof ArthronError;
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

/** Body as JSON if it parses, else as text, else `undefined` when empty. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text === "") return undefined;
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
  // Read from a clone so `error.response` stays usable by the caller.
  const data = await readBody(response.clone());
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
