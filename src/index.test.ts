import { describe, expect, expectTypeOf, it } from "vitest";
import type { Plugin } from "./";
import * as arthronModule from "./";
import { arthron, createPlugin } from "./";

describe("public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(arthronModule).sort()).toEqual(
      [
        "ArthronError",
        "createErrorInterceptor",
        "createMiddleware",
        "createPlugin",
        "createRequestInterceptor",
        "createResponseInterceptor",
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
  it("names the client's types after what they are", () => {
    expectTypeOf(arthron()).toEqualTypeOf<import("./").ArthronClient>();
    expectTypeOf(arthron().get("/x")).toEqualTypeOf<
      import("./").ResponsePromise
    >();
    expectTypeOf(arthron)
      .parameter(0)
      .toEqualTypeOf<import("./").ArthronClientOptions | undefined>();
    expectTypeOf(arthron().request)
      .parameter(1)
      .toEqualTypeOf<import("./").RequestOptionsWithMethod>();
    // @ts-expect-error Arthron is ArthronClient since 2.0
    expectTypeOf<import("./").Arthron>().not.toBeNever();
    // @ts-expect-error ArthronConfig is ArthronClientOptions since 2.0
    expectTypeOf<import("./").ArthronConfig>().not.toBeNever();
    // @ts-expect-error ArthronPromise is ResponsePromise since 2.0
    expectTypeOf<import("./").ArthronPromise>().not.toBeNever();
    // @ts-expect-error RequestInitWithBody is RequestOptionsWithMethod since 2.0
    expectTypeOf<import("./").RequestInitWithBody>().not.toBeNever();
  });
  it("drops the 1.x define helpers for create…", () => {
    // @ts-expect-error definePlugin is createPlugin since 2.0
    expectTypeOf<typeof import("./").definePlugin>().not.toBeNever();
    expectTypeOf(
      createPlugin({ pluginName: "x", requestInterceptor: (c) => c }),
    ).toEqualTypeOf<Plugin>();
  });
  it("arthron() accepts no config", () => {
    expect(() => arthron()).not.toThrow();
  });
});
