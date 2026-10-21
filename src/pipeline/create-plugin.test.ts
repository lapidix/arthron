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
    const plugin: Plugin = {
      pluginName: "trace",
      requestInterceptor: (ctx) => ctx,
    };
    expect(createPlugin(plugin)).toBe(plugin);
  });
  it("types each slot's parameters without annotations", () => {
    const plugin = createPlugin({
      pluginName: "trace",
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
  it("refuses a plugin without a pluginName", () => {
    // @ts-expect-error pluginName is required
    const unnamed = () => createPlugin({ requestInterceptor: (c) => c });
    expect(unnamed).toThrow(
      'a plugin needs a pluginName — e.g. createPlugin({ pluginName: "trace", … })',
    );
    expect(() =>
      createPlugin({ pluginName: "", middleware: (c, n) => n(c) }),
    ).toThrow(/needs a pluginName/);
  });
  it("refuses an unknown key, naming the ones it takes", () => {
    // @ts-expect-error a typo
    const typo = () => createPlugin({ pluginName: "trace", requset: (c) => c });
    expect(typo).toThrow(
      'plugin "trace" has an unknown key "requset" — use pluginName, middleware, requestInterceptor, responseInterceptor or errorInterceptor; keep state in a closure, in a function that returns createPlugin({ … })',
    );
  });
  it("reads the 1.x names from the plugin itself, not from what it inherits", () => {
    // A helper method named like a 1.x slot, on the prototype.
    const helpers = { error: () => {}, name: "helpers" };
    const plugin = Object.assign(Object.create(helpers), {
      pluginName: "trace",
      requestInterceptor: (c: RequestContext) => c,
    }) as Plugin;
    expect(createPlugin(plugin)).toBe(plugin);
  });
  it("refuses a slot that is not a function", () => {
    const header = "x-trace-id" as unknown as RequestInterceptor;
    const value = () =>
      createPlugin({ pluginName: "trace", requestInterceptor: header });
    expect(value).toThrow(
      'plugin "trace": requestInterceptor must be a function',
    );
  });
  it("refuses a plugin with nothing to run", () => {
    expect(() => createPlugin({ pluginName: "trace" })).toThrow(
      'plugin "trace" has nothing to run — add middleware, requestInterceptor, responseInterceptor or errorInterceptor',
    );
  });
  it("refuses a bare function, in the types and when it runs", () => {
    const middleware: Middleware = (ctx, next) => next(ctx);
    // @ts-expect-error a function has a `name`, but no `pluginName`
    const bare = () => createPlugin(middleware);
    expect(bare).toThrow(
      'a plugin is an object, got a function — e.g. createPlugin({ pluginName: "trace", middleware: fn })',
    );
  });
  it("refuses the 1.x name field, naming pluginName", () => {
    const middleware: Middleware = (c, n) => n(c);
    const old = { name: "audit", middleware } as unknown as Plugin;
    expect(() => createPlugin(old)).toThrow(
      'plugin "audit": the name field is called pluginName since 2.0 — rename it in the plugin',
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
    [
      "createMiddleware",
      createMiddleware,
      "createMiddleware((requestContext, next) => next(requestContext))",
    ],
    [
      "createRequestInterceptor",
      createRequestInterceptor,
      "createRequestInterceptor((requestContext) => requestContext)",
    ],
    [
      "createResponseInterceptor",
      createResponseInterceptor,
      "createResponseInterceptor((response) => response)",
    ],
    [
      "createErrorInterceptor",
      createErrorInterceptor,
      "createErrorInterceptor((error) => error)",
    ],
  ] as const)("%s refuses anything but a function", (name, create, example) => {
    expect(() => (create as (x: unknown) => unknown)("x")).toThrow(
      `arthron: ${name} needs a function — e.g. ${example}`,
    );
  });
  it("names the parameters after the types they hold", () => {
    expectTypeOf<Parameters<Middleware>>().toEqualTypeOf<
      [
        requestContext: RequestContext,
        next: (requestContext: RequestContext) => Promise<Response>,
      ]
    >();
    expectTypeOf<Parameters<ResponseInterceptor>>().toEqualTypeOf<
      [response: Response, requestContext: RequestContext]
    >();
  });
});
