# For agents

What arthron gives an AI coding agent that works with it: the API in one file, error messages that state the fix, runnable examples and a changelog.

## llms.txt

`llms.txt` is the whole API in one compressed file, meant to be read by LLM-based tools. It includes a line that maps every 1.x name to its 2.0 one.

You can find it in two places:

- in the package, at `node_modules/arthron/llms.txt`
- on this site, at [https://lapidix.github.io/arthron/llms.txt](https://lapidix.github.io/arthron/llms.txt)

## Error messages

Error messages state the fix, as in `… — pass baseURL in arthron({ baseURL }) or use an absolute URL`.

Most 1.x names throw a `TypeError` naming the new one. An agent working from an old example is told what to change:

```ts
arthron({ fetch: myFetch });
// TypeError: arthron: the fetch option was replaced by
// fetchFn in 2.0 — pass arthron({ fetchFn })
```

## Examples

[`examples/`](https://github.com/lapidix/arthron/tree/main/examples) holds type-checked, runnable recipes:

- LLM streaming
- auth refresh
- an error page
- upload and download

[`examples/recipes.test.ts`](https://github.com/lapidix/arthron/blob/main/examples/recipes.test.ts) keeps the error-page recipe honest.

## Changelog

[`CHANGELOG.md`](https://github.com/lapidix/arthron/blob/main/CHANGELOG.md) lists:

- every release
- the semver rules arthron follows since 1.0
- [Moving from 1.x](https://github.com/lapidix/arthron/blob/main/CHANGELOG.md#moving-from-1x)
