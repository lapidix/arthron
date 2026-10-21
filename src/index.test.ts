import { describe, expect, expectTypeOf, it } from "vitest";
import type { Middleware, Plugin } from "./";
import * as arthronModule from "./";
import { arthron, defineInterceptor, defineMiddleware, definePlugin } from "./";

describe("public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(arthronModule).sort()).toEqual(
      [
        "ArthronError",
        "defineInterceptor",
        "defineMiddleware",
        "definePlugin",
        "arthron",
        "isArthronError",
        "SchemaError",
      ].sort(),
    );
  });
  it("leaves the plugins' types to arthron/plugins", () => {
    // @ts-expect-error import LogEvent from "arthron/plugins"
    expectTypeOf<import("./").LogEvent>().not.toBeNever();
    // @ts-expect-error import LoggingOptions from "arthron/plugins"
    expectTypeOf<import("./").LoggingOptions>().not.toBeNever();
    // @ts-expect-error import TimeoutOptions from "arthron/plugins"
    expectTypeOf<import("./").TimeoutOptions>().not.toBeNever();
    // @ts-expect-error import RetryOptions from "arthron/plugins"
    expectTypeOf<import("./").RetryOptions>().not.toBeNever();
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
