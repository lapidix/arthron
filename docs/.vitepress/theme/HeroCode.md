<!-- The example at the top of README.md, with its long lines broken so it fits beside the hero text. Keep the two in step. -->

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
