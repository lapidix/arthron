import { describe, expect, expectTypeOf, it } from "vitest";
import type { ArthronError } from "../error/arthron-error";
import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "../types/plugin.types";
import type { RequestContext } from "../types/request.types";
import {
  createErrorInterceptor,
  createMiddleware,
  createPlugin,
  createRequestInterceptor,
  createResponseInterceptor,
} from "./create-plugin";

describe("createPlugin", () => {
  it("returns the plugin it was given", () => {
    const plugin: Plugin = { name: "trace", requestInterceptor: (ctx) => ctx };
    expect(createPlugin(plugin)).toBe(plugin);
  });
  it("types each slot's parameters without annotations", () => {
    const plugin = createPlugin({
      name: "trace",
      middleware: (ctx, next) => {
        expectTypeOf(ctx).toEqualTypeOf<RequestContext>();
        return next(ctx);
      },
      responseInterceptor: (res) => {
        expectTypeOf(res).toEqualTypeOf<Response>();
        return res;
      },
      errorInterceptor: (err) => {
        expectTypeOf(err).toEqualTypeOf<ArthronError>();
        return err;
      },
    });
    expectTypeOf(plugin).toEqualTypeOf<Plugin>();
  });
  it("refuses a plugin without a name", () => {
    // @ts-expect-error name is required
    const unnamed = () => createPlugin({ requestInterceptor: (c) => c });
    expect(unnamed).toThrow(
      'a plugin needs a name — e.g. createPlugin({ name: "trace", … })',
    );
    expect(() =>
      createPlugin({ name: "", middleware: (c, n) => n(c) }),
    ).toThrow(/needs a name/);
  });
  it("refuses an unknown key, naming the ones it takes", () => {
    // @ts-expect-error a typo
    const typo = () => createPlugin({ name: "trace", requset: (c) => c });
    expect(typo).toThrow(
      'plugin "trace" has an unknown key "requset" — use name, middleware, requestInterceptor, responseInterceptor or errorInterceptor',
    );
  });
  it("refuses a slot that is not a function", () => {
    const header = "x-trace-id" as unknown as RequestInterceptor;
    const value = () =>
      createPlugin({ name: "trace", requestInterceptor: header });
    expect(value).toThrow(
      'plugin "trace": requestInterceptor must be a function',
    );
  });
  it("refuses a plugin with nothing to run", () => {
    expect(() => createPlugin({ name: "trace" })).toThrow(
      'plugin "trace" has nothing to run — add middleware, requestInterceptor, responseInterceptor or errorInterceptor',
    );
  });
  it("refuses a bare function, which TypeScript lets through", () => {
    // A function has a `name`, so it fits Plugin's type; only this check stops it.
    const middleware: Middleware = (ctx, next) => next(ctx);
    const bare = () => createPlugin(middleware);
    expect(bare).toThrow(
      'a plugin is an object, got a function — e.g. createPlugin({ name: "trace", middleware: fn })',
    );
  });
});

describe("createMiddleware and the create…Interceptor helpers", () => {
  it("return the function they were given, typed", () => {
    const middleware = createMiddleware((ctx, next) => next(ctx));
    expectTypeOf(middleware).toEqualTypeOf<Middleware>();
    const request = createRequestInterceptor((ctx) => ctx);
    expectTypeOf(request).toEqualTypeOf<RequestInterceptor>();
    const response = createResponseInterceptor((res) => res);
    expectTypeOf(response).toEqualTypeOf<ResponseInterceptor>();
    const error = createErrorInterceptor((err) => err);
    expectTypeOf(error).toEqualTypeOf<ErrorInterceptor>();
    const fn: Middleware = (ctx, next) => next(ctx);
    expect(createMiddleware(fn)).toBe(fn);
  });
  it.each([
    ["createMiddleware", createMiddleware],
    ["createRequestInterceptor", createRequestInterceptor],
    ["createResponseInterceptor", createResponseInterceptor],
    ["createErrorInterceptor", createErrorInterceptor],
  ] as const)("%s refuses anything but a function", (name, create) => {
    expect(() => (create as (x: unknown) => unknown)("x")).toThrow(
      `${name} needs a function`,
    );
  });
});
