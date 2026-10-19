/**
 * The Standard Schema interface (https://standardschema.dev), vendored as
 * types only so arthron keeps zero dependencies. Zod, Valibot, ArkType and
 * others implement it, so their schemas can be passed to `.json(schema)`.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => SchemaResult<Output> | Promise<SchemaResult<Output>>;
    readonly types?:
      | { readonly input: Input; readonly output: Output }
      | undefined;
  };
}

export type SchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly SchemaIssue[] };

export interface SchemaIssue {
  readonly message: string;
  readonly path?:
    | readonly (PropertyKey | { readonly key: PropertyKey })[]
    | undefined;
}

/** The type a schema produces. */
export type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];

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
