# For agents

- **`llms.txt`** ships in the package (`node_modules/arthron/llms.txt`) and is served by this site at [`https://lapidix.github.io/arthron/llms.txt`](https://lapidix.github.io/arthron/llms.txt): the whole API in one compressed file, meant to be read by LLM-based tools — including a line that maps every 1.x name to its 2.0 one.
- **Error messages state the fix** (`… — pass baseURL in arthron({ baseURL }) or use an absolute URL`), and most 1.x names throw a `TypeError` naming the new one, so an agent working from an old example is told what to change.
- **[`examples/`](https://github.com/lapidix/arthron/tree/main/examples)** holds type-checked, runnable recipes: LLM streaming, auth refresh, an error page, upload/download. [`examples/recipes.test.ts`](https://github.com/lapidix/arthron/blob/main/examples/recipes.test.ts) keeps the error-page recipe honest.
- **[`CHANGELOG.md`](https://github.com/lapidix/arthron/blob/main/CHANGELOG.md)** lists every release, the semver rules arthron follows since 1.0, and [Moving from 1.x](https://github.com/lapidix/arthron/blob/main/CHANGELOG.md#moving-from-1x).
