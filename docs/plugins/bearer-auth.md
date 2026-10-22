# bearerAuth

`bearerAuth(options)` sends a bearer token with each request to your API, and refreshes the session when a call gets a 401.

```ts
const api = arthron({
  baseURL: API,
  plugins: [
    bearerAuth({
      tokenOrigins: [API],
      accessTokenFn: () => session.accessToken,
      refreshFn: async () => {
        const tokens = await api
          .post("/token/refresh", undefined, {
            meta: { bearerAuth: false },
          })
          .json<{ access_token: string }>();
        session.accessToken = tokens.access_token;
      },
    }),
  ],
});
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `tokenOrigins` | required | The URLs the token may go to. See [Where the token goes](#where-the-token-goes). |
| `accessTokenFn` | required | `() => string \| null \| undefined`, or a promise of one. Returns the current token. |
| `refreshFn` | — | `() => Promise<void>`, called after a 401. See [Refreshing on 401](#refreshing-on-401). |

## Where the token goes

The token goes to `tokenOrigins` only — never to a CDN or a URL taken from a response body.

Only the origin of each URL counts, so your `baseURL` works as is: `tokenOrigins: [API]`.

A relative `baseURL` such as `"/api"` sends requests to the page's own origin. List that origin, such as `"https://app.example.com"`. `"/api"` itself is not an http(s) URL.

`bearerAuth()` throws a `TypeError` for:

- an entry that is not an http(s) URL
- an empty list
- one string instead of a list

## The access token

`accessTokenFn` is read on every attempt. When it returns no token, the request goes without an `authorization` header.

The token is treated as opaque. To refresh a JWT ahead of its `exp`, do it inside `accessTokenFn`.

## Refreshing on 401

After a 401, `refreshFn` refreshes the session, so that the next `accessTokenFn()` returns the new token. Then the call is redone once.

Without `refreshFn`, a 401 is thrown as is.

### Concurrent 401s

Concurrent 401s share one refresh. With refresh-token rotation, parallel refreshes would revoke each other and log the user out.

A call whose token was already replaced by another call's refresh retries without refreshing again.

### When the 401 is thrown

- A second 401 is thrown.
- A failed refresh is thrown too: every call waiting on it rejects with the error `refreshFn` threw. That is the place to send the user to a login page.
- The 401 of a `ReadableStream` body is thrown without a refresh. The first try has read the stream, so there is nothing to resend.

## Per-call settings

`meta: { bearerAuth: false }` sends no token and never refreshes. Use it for the login and refresh endpoints:

```ts
api.post("/login", credentials, {
  meta: { bearerAuth: false },
});
```

### Requests made by refreshFn

A request that `refreshFn` starts through the same client before its first `await` goes out as if it had `meta: { bearerAuth: false }`.

::: warning
A request `refreshFn` starts after an `await` needs `meta: { bearerAuth: false }` itself. Without it, its 401 would wait for the refresh it is part of.
:::

## Cookie sessions

`bearerAuth` is not for cookie sessions.

It tells whether another call already refreshed by comparing the `authorization` header a call sent with the current one. An httpOnly cookie cannot be read to compare.
