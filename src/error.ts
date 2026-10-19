import type { RequestContext } from "./types";

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
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly data: unknown;
  readonly request: RequestContext;
  readonly response: Response | undefined;
  override readonly cause: unknown;

  constructor(init: ArthronErrorInit) {
    super(init.message);
    this.status = init.status;
    this.statusText = init.statusText;
    this.headers = init.headers;
    this.data = init.data;
    this.request = init.request;
    this.response = init.response;
    this.cause = init.cause;
  }
}

export function isArthronError(error: unknown): error is ArthronError {
  return error instanceof ArthronError;
}

/** Cancellation is not an HTTP failure. Matched by name so it works across realms. */
export function isCancellation(error: unknown): boolean {
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
