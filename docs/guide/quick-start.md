# Quick start

Install arthron, create a client with a few plugins and make your first call.

## Install

```sh
npm i arthron
```

## Make a call

```ts
import { arthron, isArthronError } from "arthron";
import { logging, retry, timeout } from "arthron/plugins";

const api = arthron({
  baseURL: "https://api.example.com",
  // 10 s for the whole call, retries included
  plugins: [logging(), timeout(10_000), retry()],
});

async function getUser(id: string) {
  try {
    return await api
      .get("/users/{id}", { pathParams: { id } })
      .json<User>();
  } catch (e) {
    // ArthronError: a 4xx/5xx or a network failure.
    // Cancellation and plugin bugs are not.
    if (isArthronError(e) && e.status === 404) return null;
    throw e;
  }
}
```

## Coming from 1.x

Most old names throw a `TypeError` that names the new one. The full list is in [Moving from 1.x](https://github.com/lapidix/arthron/blob/main/CHANGELOG.md#moving-from-1x).

## Writing code with an AI agent

Point it at `llms.txt`, which ships in the package. See [For agents](/agents).
