<!-- The home comparison, arthron side. Keep it doing what CompareFetch.md does, within the same line length. -->

```ts
const api = arthron({
  baseURL: API,
  // one deadline for the whole call, retries included
  plugins: [timeout(10_000), retry()],
});

async function getUser(id: string) {
  try {
    return await api
      .get("/users/{id}", { pathParams: { id } })
      .json<User>();
  } catch (e) {
    if (isArthronError(e) && e.status === 404) return null;
    throw e;
  }
}
```
