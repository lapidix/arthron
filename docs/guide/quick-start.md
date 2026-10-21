# Quick start

```sh
npm i arthron
```

```ts
import { arthron, isArthronError } from "arthron";
import { logging, retry, timeout } from "arthron/plugins";

const api = arthron({
  baseURL: "https://api.example.com",
  plugins: [logging(), timeout(10_000), retry()], // 10 s for the whole call, retries included
});

try {
  const user = await api.get("/users/{id}", { pathParams: { id } }).json<User>();
} catch (e) {
  if (isArthronError(e)) toast(e.description ?? "Something went wrong"); // 4xx/5xx or a network failure
  else throw e; // cancellation, or a bug in a plugin
}
```

Coming from 1.x? Most old names throw a `TypeError` that names the new one; the full list is in [Moving from 1.x](https://github.com/lapidix/arthron/blob/main/CHANGELOG.md#moving-from-1x). Writing code with an AI agent? Point it at `llms.txt`, which ships in the package — see [For agents](/agents).
