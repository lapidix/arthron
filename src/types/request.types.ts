type QueryValue = string | number | boolean | null | undefined;

/**
 * Query parameters. `null`/`undefined` values are skipped, an array becomes
 * repeated keys (`ids=1&ids=2`), and a `URLSearchParams` is used as is.
 */
export type QueryParams =
  | Record<string, QueryValue | readonly QueryValue[]>
  | URLSearchParams;

/**
 * Headers as config and per-call options accept them: any `HeadersInit`, or a
 * plain object whose `null`/`undefined` values delete that header from the
 * layer underneath (a client default, an inherited header).
 */
export type HeadersOption =
  | HeadersInit
  | Record<string, string | null | undefined>;
