<!-- The example at the top of README.md, with its long lines broken so it fits beside the hero text. Keep the two in step. -->

```ts
import { arthron, isArthronError } from "arthron";
import { logging, retry, timeout } from "arthron/plugins";

const api = arthron({
  baseURL: "https://api.example.com",
  // 10 s for the whole call, retries included
  plugins: [logging(), timeout(10_000), retry()],
});

try {
  const user = await api
    .get("/users/{id}", { pathParams: { id } })
    .json<User>();
} catch (e) {
  if (isArthronError(e))
    // 4xx/5xx or a network failure
    toast(e.description ?? "Something went wrong");
  else throw e; // cancellation, or a bug in a plugin
}
```
