import { redactUrl } from "../request/url";
import type { RequestContext } from "../types/context.types";

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
