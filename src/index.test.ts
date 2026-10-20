import { describe, expect, expectTypeOf, it } from "vitest";
import type { Middleware, Plugin } from "./";
import * as arthronModule from "./";
import { arthron, defineInterceptor, defineMiddleware, definePlugin } from "./";

describe("public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(arthronModule).sort()).toEqual(
      [
        "ArthronError",
        "auth",
        "defineInterceptor",
        "defineMiddleware",
        "definePlugin",
        "arthron",
        "isArthronError",
        "logging",
        "retry",
        "SchemaError",
        "timeout",
      ].sort(),
    );
  });
  it("define helpers are identity and infer types", () => {
    const m: Middleware = async (_c, next) => next(_c);
    expect(defineMiddleware(m)).toBe(m);
    const p = definePlugin({ name: "x" });
    expectTypeOf(p).toEqualTypeOf<Plugin>();
    const r = defineInterceptor.request((c) => c);
    expectTypeOf(r).parameter(0).toHaveProperty("url");
  });
  it("arthron() accepts no config", () => {
    expect(() => arthron()).not.toThrow();
  });
});
