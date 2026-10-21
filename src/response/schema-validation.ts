import type { ArthronSchema } from "../types/response.types";

const pathOf = (issue: ArthronSchema.Issue): string =>
  (issue.path ?? [])
    .map((part) =>
      String(typeof part === "object" && part !== null ? part.key : part),
    )
    .join(".");

/**
 * `.json(schema)` got a body that does not match the schema. Not an
 * ArthronError: the request succeeded — the data is what is wrong.
 */
export class SchemaMismatchError extends Error {
  override readonly name = "SchemaMismatchError";
  /** Every problem the validator reported, with the path to it. */
  readonly issues: readonly ArthronSchema.Issue[];

  constructor(issues: readonly ArthronSchema.Issue[]) {
    const [first] = issues;
    const where = first ? pathOf(first) : "";
    const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
    super(
      `arthron: the response body does not match the schema — ${where ? `${where}: ` : ""}${first?.message ?? "invalid"}${more}. See error.issues`,
    );
    this.issues = issues;
  }
}

/** Validate `body`; resolve with the schema's output or reject with a SchemaMismatchError. */
export async function validate<S extends ArthronSchema>(
  schema: S,
  body: unknown,
): Promise<ArthronSchema.Infer<S>> {
  const result = await schema["~standard"].validate(body);
  if (result.issues) throw new SchemaMismatchError(result.issues);
  return result.value as ArthronSchema.Infer<S>;
}
