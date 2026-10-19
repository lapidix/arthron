import { describe, expect, expectTypeOf, it } from "vitest";
import type { Middleware, Plugin } from "./index";
import * as ieumModule from "./index";
import {
  defineInterceptor,
  defineMiddleware,
  definePlugin,
  ieum,
} from "./index";

describe("public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(ieumModule).sort()).toEqual(
      [
        "IeumError",
        "defineInterceptor",
        "defineMiddleware",
        "definePlugin",
        "ieum",
        "isIeumError",
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
  it("ieum() accepts no config", () => {
    expect(() => ieum()).not.toThrow();
  });
});
