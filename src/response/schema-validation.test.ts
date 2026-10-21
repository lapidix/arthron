import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, expectTypeOf, it } from "vitest";
import { isArthronError } from "../error/arthron-error";
import { jsonResponse } from "../testkit/fetch.testkit";
import type { ArthronSchema } from "../types/response.types";
import { toResponsePromise } from "./response-promise";
import { SchemaMismatchError } from "./schema-validation";

/** A hand-written Standard Schema — what Zod, Valibot or ArkType hand you. */
const user: ArthronSchema<unknown, { id: number; name: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const v = value as { id?: unknown; name?: unknown };
      if (typeof v?.id !== "number") {
        return { issues: [{ message: "Expected a number", path: ["id"] }] };
      }
      // Validators may transform: trim the name.
      return { value: { id: v.id, name: String(v.name ?? "").trim() } };
    },
  },
};
const body = (data: unknown) =>
  toResponsePromise(Promise.resolve(jsonResponse(data)));

describe(".json(schema)", () => {
  it("resolves with the validated (and transformed) value, typed by the schema", async () => {
    const out = await body({ id: 1, name: "  kim " }).json(user);
    expect(out).toEqual({ id: 1, name: "kim" });
    expectTypeOf(out).toEqualTypeOf<{ id: number; name: string }>();
  });
  it("rejects with a SchemaMismatchError carrying the issues — not an ArthronError", async () => {
    const err = await body({ id: "1" })
      .json(user)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaMismatchError);
    expect(isArthronError(err)).toBe(false);
    expect((err as SchemaMismatchError).issues).toEqual([
      { message: "Expected a number", path: ["id"] },
    ]);
    expect((err as Error).message).toMatch(/id: Expected a number/);
  });
  it("supports validators that answer asynchronously", async () => {
    const later: ArthronSchema<unknown, number> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (v) => ({ value: Number(v) }),
      },
    };
    expect(await body("7").json(later)).toBe(7);
  });
  it("leaves .json<T>() without a schema as a plain cast", async () => {
    const out = await body({ any: "thing" }).json<{ any: string }>();
    expect(out).toEqual({ any: "thing" });
  });
});

describe("ArthronSchema is the Standard Schema under arthron's name", () => {
  type User = { id: number; name: string };
  it("takes any StandardSchemaV1 from @standard-schema/spec, and asks for nothing more", () => {
    expectTypeOf<StandardSchemaV1<unknown, User>>().toExtend<
      ArthronSchema<unknown, User>
    >();
    expectTypeOf<ArthronSchema<unknown, User>>().toExtend<
      StandardSchemaV1<unknown, User>
    >();
  });
  it("infers what StandardSchemaV1.InferOutput infers", () => {
    type Official = StandardSchemaV1<unknown, User>;
    expectTypeOf<ArthronSchema.Infer<Official>>().toEqualTypeOf<
      StandardSchemaV1.InferOutput<Official>
    >();
    expectTypeOf<ArthronSchema.Infer<typeof user>>().toEqualTypeOf<User>();
  });
  it("names an issue and a validation result as the spec shapes them", () => {
    expectTypeOf<StandardSchemaV1.Issue>().toExtend<ArthronSchema.Issue>();
    expectTypeOf<ArthronSchema.Issue>().toExtend<StandardSchemaV1.Issue>();
    expectTypeOf<StandardSchemaV1.Result<User>>().toExtend<
      ArthronSchema.ValidationResult<User>
    >();
    expectTypeOf<SchemaMismatchError["issues"]>().toEqualTypeOf<
      readonly ArthronSchema.Issue[]
    >();
  });
});
