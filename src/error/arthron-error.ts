import { redactUrl } from "../request/url";
import type { RequestContext } from "../types/request.types";

type ArthronErrorInit = {
  message: string;
  status: number;
  statusText: string;
  headers: Headers;
  payload: unknown;
  description?: string | undefined;
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
  /**
   * The failed response's payload, parsed: JSON if it parses, else the text;
   * `undefined` for a network failure, which has no response. At most 64 KiB
   * is read (text if cut). `response.body`, by contrast, is the stream.
   */
  readonly payload: unknown;
  /**
   * For people: the server's description of the failure, extracted from
   * `payload` (by default its `message` → `error` → `error.message` →
   * `detail`; see the `extractDescription` option). `undefined` when there was
   * none, and for a network failure. Untrusted server text: show it as text,
   * never as HTML. `message`, by contrast, is arthron's — method, URL
   * without query, status — for logs, not for people.
   */
  readonly description: string | undefined;
  /**
   * The context that was sent — url and init after request interceptors.
   * Not enumerable: it holds credentials, so `JSON.stringify`, `console.error`
   * and error trackers leave it out. Read it directly when you need it.
   */
  declare readonly request: RequestContext;
  /** The failed Response, still readable — its body holds what arthron read (at most 64 KiB). Absent for network failures. Not enumerable. */
  declare readonly response: Response | undefined;
  /** The underlying error for network failures, with the URL's query and userinfo taken out of its message, stack and causes. */
  override readonly cause: unknown;

  constructor(init: ArthronErrorInit) {
    super(init.message);
    this.status = init.status;
    this.statusText = init.statusText;
    this.payload = init.payload;
    this.description = init.description;
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
    // biome-ignore-start lint/complexity/noThisInStatic: `this` is the class on the right of instanceof; naming ArthronError instead would make every subclass match every ArthronError
    return this === ArthronError
      ? isArthronError(value)
      : Function.prototype[Symbol.hasInstance].call(this, value);
    // biome-ignore-end lint/complexity/noThisInStatic: see above
  }

  /** What serializers see: no headers, no request body, no query or userinfo. */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      description: this.description,
      status: this.status,
      statusText: this.statusText,
      method: this.request.init.method ?? "GET",
      url: redactUrl(this.request.url),
      payload: this.payload,
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
