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
   * rejects with that error. A request it starts through the same client
   * before its first `await` goes out as with `meta: { bearerAuth: false }`
   * (no token, no refresh on its 401); one started after an `await` needs
   * that meta itself, or its 401 would wait for the refresh it is part of.
   * Without `refreshFn`, or for a `ReadableStream` body (already read, so it
   * cannot be resent), a 401 is thrown as is.
   */
  refreshFn?: () => Promise<void>;
};
