import { isArthronError } from "../error/arthron-error";
import { isCancellation } from "../error/error";
import { redactUrl } from "../request/url";
import type { Plugin } from "../types/plugin.types";
import type { LogEvent, LoggingOptions } from "./logging.types";

function consoleSink(logger: Pick<Console, "log" | "error">) {
  return (e: LogEvent) => {
    if (e.phase === "start") {
      logger.log(`[arthron] → ${e.method} ${e.path}`);
    } else if (e.phase === "success") {
      logger.log(`[arthron] ← ${e.method} ${e.path} ${e.status} ${e.ms}ms`);
    } else {
      logger.error(
        `[arthron] ✕ ${e.method} ${e.path} ${e.status ?? "-"} ${e.ms}ms`,
      );
    }
  };
}

/**
 * One event when a request starts, one when it settles, with status and
 * elapsed time. Wraps the whole call, so retries are included in the time.
 * Default output is a console line per event; pass `onEvent` to get the
 * structured event instead. Cancellations are not reported.
 */
export function logging(options: LoggingOptions = {}): Plugin {
  const {
    enabled = true,
    logger = console,
    onEvent,
    now = () => performance.now(),
  } = options;
  const emit = onEvent ?? consoleSink(logger);
  return {
    name: "logging",
    middleware: async (ctx, next) => {
      if (!enabled) return next(ctx);
      const method = ctx.init.method ?? "GET";
      const path = redactUrl(ctx.url);
      const started = now();
      const ms = () => Math.round(now() - started);

      emit({ phase: "start", method, path });
      let res: Response;
      try {
        res = await next(ctx);
      } catch (error) {
        if (!isCancellation(error, ctx.init.signal)) {
          const status = isArthronError(error) ? error.status : undefined;
          emit({ phase: "error", method, path, status, ms: ms(), error });
        }
        throw error;
      }
      // Outside the try: a sink that throws is a plugin bug, not a failed request.
      emit({ phase: "success", method, path, status: res.status, ms: ms() });
      return res;
    },
  };
}
