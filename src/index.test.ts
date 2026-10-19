import { describe, expect, expectTypeOf, it } from "vitest";
import type { Middleware, Plugin } from "./index";
import * as ferruleModule from "./index";
import {
  defineInterceptor,
  defineMiddleware,
  definePlugin,
  ferrule,
} from "./index";

describe("public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(ferruleModule).sort()).toEqual(
      [
        "FerruleError",
        "defineInterceptor",
        "defineMiddleware",
        "definePlugin",
        "ferrule",
        "isFerruleError",
        "logging",
        "retry",
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
  it("ferrule() accepts no config", () => {
    expect(() => ferrule()).not.toThrow();
  });
});
