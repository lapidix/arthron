<!-- The home comparison, fetch side: what getUser takes without arthron. It must do what CompareArthron.md does — a 10 s deadline for the whole call, two retries with backoff on the statuses retry() retries and on network failures, null for a 404 — and nothing more. Lines stay within about 60 characters, so they fit their half of the row. -->

```ts
const retryable = [408, 429, 500, 502, 503, 504];
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function getUser(id: string) {
  const url = `${API}/users/${encodeURIComponent(id)}`;
  // one deadline for the whole call, retries included
  const signal = AbortSignal.timeout(10_000);
  for (let attempt = 0; ; attempt++) {
    const last = attempt === 2;
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      // timed out, or out of attempts
      if (signal.aborted || last) throw error;
      await sleep(Math.random() * 300 * 2 ** attempt);
      continue;
    }
    if (response.ok) return (await response.json()) as User;
    if (response.status === 404) return null;
    if (last || !retryable.includes(response.status)) {
      throw new Error(`GET ${url} failed: ${response.status}`);
    }
    await sleep(Math.random() * 300 * 2 ** attempt);
  }
}
```
