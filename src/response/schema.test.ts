import { describe, expect, expectTypeOf, it } from "vitest";
import { isArthronError } from "../error/arthron-error";
import { jsonResponse } from "../testkit/fetch.testkit";
import type { StandardSchemaV1 } from "../types/schema.types";
import { toArthronPromise } from "./promise";
import { SchemaError } from "./schema";

/** A hand-written Standard Schema — what Zod, Valibot or ArkType hand you. */
const user: StandardSchemaV1<unknown, { id: number; name: string }> = {
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
  toArthronPromise(Promise.resolve(jsonResponse(data)));

describe(".json(schema)", () => {
  it("resolves with the validated (and transformed) value, typed by the schema", async () => {
    const out = await body({ id: 1, name: "  kim " }).json(user);
    expect(out).toEqual({ id: 1, name: "kim" });
    expectTypeOf(out).toEqualTypeOf<{ id: number; name: string }>();
  });
  it("rejects with a SchemaError carrying the issues — not an ArthronError", async () => {
    const err = await body({ id: "1" })
      .json(user)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaError);
    expect(isArthronError(err)).toBe(false);
    expect((err as SchemaError).issues).toEqual([
      { message: "Expected a number", path: ["id"] },
    ]);
    expect((err as Error).message).toMatch(/id: Expected a number/);
  });
  it("supports validators that answer asynchronously", async () => {
    const later: StandardSchemaV1<unknown, number> = {
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
