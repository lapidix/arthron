import type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "../types/plugin.types";

/** The slots a plugin may fill. */
const SLOTS = [
  "middleware",
  "requestInterceptor",
  "responseInterceptor",
  "errorInterceptor",
] as const;

/** 1.x slot names: a plugin that still uses one would have it ignored. */
const REPLACED_SLOTS = {
  request: "requestInterceptor",
  response: "responseInterceptor",
  error: "errorInterceptor",
} as const;

/**
 * Throws a TypeError for what a plugin can get wrong where TypeScript does
 * not look — JS, a cast, an object built at runtime: not an object, no name,
 * a key it does not take (a typo, a 1.x slot), a slot that is not a
 * function, or nothing to run. `createPlugin` runs it where the plugin is
 * written; `use` and `plugins` run it again on whatever they are given.
 */
export function checkPlugin(plugin: unknown): asserts plugin is Plugin {
  if (typeof plugin !== "object" || plugin === null) {
    const got = plugin === null ? "null" : `a ${typeof plugin}`;
    throw new TypeError(
      `arthron: a plugin is an object, got ${got} — e.g. createPlugin({ name: "trace", middleware: fn })`,
    );
  }
  const fields = plugin as Record<string, unknown>;
  const named = typeof fields.name === "string" && fields.name !== "";
  const label = named ? `plugin "${fields.name}"` : "a plugin";
  for (const [old, now] of Object.entries(REPLACED_SLOTS)) {
    if (fields[old] !== undefined) {
      throw new TypeError(
        `arthron: ${label}: the ${old} interceptor is called ${now} since 2.0 — rename it in the plugin`,
      );
    }
  }
  if (!named) {
    throw new TypeError(
      'arthron: a plugin needs a name — e.g. createPlugin({ name: "trace", … })',
    );
  }
  for (const key of Object.keys(fields)) {
    if (key !== "name" && !(SLOTS as readonly string[]).includes(key)) {
      throw new TypeError(
        `arthron: ${label} has an unknown key "${key}" — use name, middleware, requestInterceptor, responseInterceptor or errorInterceptor`,
      );
    }
  }
  for (const slot of SLOTS) {
    if (fields[slot] !== undefined && typeof fields[slot] !== "function") {
      throw new TypeError(`arthron: ${label}: ${slot} must be a function`);
    }
  }
  if (SLOTS.every((slot) => fields[slot] === undefined)) {
    throw new TypeError(
      `arthron: ${label} has nothing to run — add middleware, requestInterceptor, responseInterceptor or errorInterceptor`,
    );
  }
}

/**
 * A plugin, checked where it is written and typed without annotations:
 * `createPlugin({ name: "trace", requestInterceptor: (ctx) => … })`.
 */
export function createPlugin(plugin: Plugin): Plugin {
  checkPlugin(plugin);
  return plugin;
}

function aFunction<T>(value: T, helper: string, example: string): T {
  if (typeof value !== "function") {
    throw new TypeError(
      `arthron: ${helper} needs a function — e.g. ${example}`,
    );
  }
  return value;
}

/** A middleware written on its own, typed without annotations. */
export const createMiddleware = (middleware: Middleware): Middleware =>
  aFunction(
    middleware,
    "createMiddleware",
    "createMiddleware((ctx, next) => next(ctx))",
  );

/** A request interceptor written on its own, typed without annotations. */
export const createRequestInterceptor = (
  interceptor: RequestInterceptor,
): RequestInterceptor =>
  aFunction(
    interceptor,
    "createRequestInterceptor",
    "createRequestInterceptor((ctx) => ctx)",
  );

/** A response interceptor written on its own, typed without annotations. */
export const createResponseInterceptor = (
  interceptor: ResponseInterceptor,
): ResponseInterceptor =>
  aFunction(
    interceptor,
    "createResponseInterceptor",
    "createResponseInterceptor((res) => res)",
  );

/** An error interceptor written on its own, typed without annotations. */
export const createErrorInterceptor = (
  interceptor: ErrorInterceptor,
): ErrorInterceptor =>
  aFunction(
    interceptor,
    "createErrorInterceptor",
    "createErrorInterceptor((err) => err)",
  );
