export type BearerAuthOptions = {
  /**
   * Where the token may go: a URL, or several. Only their origins count, so
   * your `baseURL` works as is. A request anywhere else — a CDN, a URL taken
   * from a response body — is sent without the token.
   */
  origin: string | readonly string[];
  /**
   * The current access token, read on every attempt. `null`, `undefined` or
   * `""` sends no `authorization` header.
   */
  token: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Get a new token after a 401; the call is then redone once. Concurrent
   * 401s share one refresh, and a call whose token was already replaced
   * retries without one. Throw when the refresh fails — every waiting call
   * rejects with that error. Requests the refresh makes through the same
   * client need `meta: { bearerAuth: false }`. Without `refresh`, or for a
   * `ReadableStream` body (already read, so it cannot be resent), a 401 is
   * thrown as is.
   */
  refresh?: () => Promise<void>;
};
