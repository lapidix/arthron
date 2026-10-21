# `bearerAuth(options)`

Bearer tokens, with a refresh on 401.

```ts
const api = arthron({
  baseURL: API,
  plugins: [
    bearerAuth({
      tokenOrigins: [API],
      accessTokenFn: () => session.accessToken,
      refreshFn: async () => {
        const tokens = await api
          .post("/token/refresh", undefined, { meta: { bearerAuth: false } })
          .json<{ access_token: string }>();
        session.accessToken = tokens.access_token;
      },
    }),
  ],
});
```

| option | default | |
|---|---|---|
| `tokenOrigins` | required | a list of URLs; only their origins count, so `[baseURL]` works as is — a relative one (`"/api"`) is on the page's origin. An entry that is not an http(s) URL, an empty list or one string instead of a list is a `TypeError` |
| `accessTokenFn` | required | `() => string \| null \| undefined`, or a promise of one; read on every attempt. No token, no header |
| `refreshFn` | — | `() => Promise<void>`, called after a 401 to refresh the session, so the next `accessTokenFn()` returns the new token; then the call is redone once. Without it, a 401 is thrown as is |

**Per call:** `meta: { bearerAuth: false }` sends no token and never refreshes. Use it for the login and refresh endpoints. A request `refreshFn` starts through the same client before its first `await` is sent that way on its own; one it starts after an `await` needs the meta, or its 401 would wait for the refresh it is part of.

The token goes to `tokenOrigins` only — never to a CDN or a URL taken from a response body. Concurrent 401s share one refresh: with refresh-token rotation, parallel refreshes would revoke each other and log the user out. A call whose token was already replaced by another call's refresh retries without refreshing again. A second 401 is thrown, and so is a failed refresh — every call waiting on it rejects with the error `refreshFn` threw, so that is the place to send the user to a login page. The 401 of a `ReadableStream` body is thrown without a refresh: the first try has read the stream, so there is nothing to resend.

The token is treated as opaque: to refresh a JWT ahead of its `exp`, do it inside `accessTokenFn`. It is not for cookie sessions: it tells whether another call already refreshed by comparing the `authorization` header a call sent with the current one, and an httpOnly cookie cannot be read to compare.
