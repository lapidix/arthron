import type {
  InferOutput,
  SchemaIssue,
  StandardSchemaV1,
} from "../types/response.types";

const pathOf = (issue: SchemaIssue): string =>
  (issue.path ?? [])
    .map((part) =>
      String(typeof part === "object" && part !== null ? part.key : part),
    )
    .join(".");

/**
 * `.json(schema)` got a body that does not match. Not an ArthronError: the
 * request succeeded — the data is what is wrong.
 */
export class SchemaError extends Error {
  override readonly name = "SchemaError";
  /** Every problem the validator reported, with the path to it. */
  readonly issues: readonly SchemaIssue[];

  constructor(issues: readonly SchemaIssue[]) {
    const [first] = issues;
    const where = first ? pathOf(first) : "";
    const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
    super(
      `arthron: the response body does not match the schema — ${where ? `${where}: ` : ""}${first?.message ?? "invalid"}${more}. See error.issues`,
    );
    this.issues = issues;
  }
}

/** Validate `data`; resolve with the schema's output or reject with a SchemaError. */
export async function validate<S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): Promise<InferOutput<S>> {
  const result = await schema["~standard"].validate(data);
  if (result.issues) throw new SchemaError(result.issues);
  return result.value as InferOutput<S>;
}
