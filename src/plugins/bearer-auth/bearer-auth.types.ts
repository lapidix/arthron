export type BearerAuthOptions = {
  /**
   * Where the token may go: a URL, or several. Only their origins count, so
   * your `baseURL` works as is. A request anywhere else — a CDN, a URL taken
   * from a response body — is sent without the token.
   */
  origin: string | readonly string[];
  /**
   * Returns the current access token; called on every attempt. `null`,
   * `undefined` or `""` sends no `authorization` header.
   */
  accessTokenFn: () =>
    | string
    | null
    | undefined
    | Promise<string | null | undefined>;
  /**
   * Gets a new access token after a 401; the call is then redone once.
   * Concurrent 401s share one refresh, and a call whose token was already
   * replaced retries without one. Throw when the refresh fails — every waiting call
   * rejects with that error. Requests the refresh makes through the same
   * client need `meta: { bearerAuth: false }`. Without `refreshFn`, or for a
   * `ReadableStream` body (already read, so it cannot be resent), a 401 is
   * thrown as is.
   */
  refreshFn?: () => Promise<void>;
};
