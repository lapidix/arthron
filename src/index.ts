import * as plugins from "./plugins/index";

export { arthron } from "./client/client";
export type {
  Arthron,
  ArthronConfig,
  HttpMethod,
  RequestInitWithBody,
  RequestOptions,
} from "./client/client.types";
export { ArthronError, isArthronError } from "./error/arthron-error";
export {
  defineInterceptor,
  defineMiddleware,
  definePlugin,
} from "./pipeline/define-plugin";
export { SchemaError } from "./response/schema-validation";
export type {
  ErrorInterceptor,
  Middleware,
  Plugin,
  RequestInterceptor,
  ResponseInterceptor,
} from "./types/plugin.types";
export type {
  ArthronMeta,
  HeadersOption,
  QueryParams,
  RequestContext,
  RetryOptions,
} from "./types/request.types";
export type {
  ArthronPromise,
  ErrorDetailResolver,
  InferOutput,
  NdjsonOptions,
  SchemaIssue,
  SseEvent,
  SseOptions,
  StandardSchemaV1,
} from "./types/response.types";

/*
 * The built-in plugins moved to "arthron/plugins". These keep 1.0 imports
 * working until the next major; they are the same functions.
 */

/** @deprecated Import from "arthron/plugins"; this export goes in the next major. */
export const logging: typeof plugins.logging = plugins.logging;
/** @deprecated Import from "arthron/plugins"; this export goes in the next major. */
export const retry: typeof plugins.retry = plugins.retry;
/** @deprecated Import from "arthron/plugins"; this export goes in the next major. */
export const timeout: typeof plugins.timeout = plugins.timeout;
/** @deprecated Import from "arthron/plugins"; this export goes in the next major. */
export type LogEvent = plugins.LogEvent;
/** @deprecated Import from "arthron/plugins"; this export goes in the next major. */
export type LoggingOptions = plugins.LoggingOptions;
/** @deprecated Import from "arthron/plugins"; this export goes in the next major. */
export type TimeoutOptions = plugins.TimeoutOptions;
