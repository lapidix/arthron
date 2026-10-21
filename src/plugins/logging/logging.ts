import { isArthronError } from "../../error/arthron-error";
import { isCancellation } from "../../error/create-error";
import { redactUrl } from "../../request/url";
import type { Plugin } from "../../types/plugin.types";
import type { LogEvent, LoggingOptions } from "./logging.types";

function consoleSink(logger: Pick<Console, "log" | "error">) {
  return (e: LogEvent) => {
    if (e.phase === "start") {
      logger.log(`[arthron] → ${e.method} ${e.url}`);
    } else if (e.phase === "success") {
      logger.log(
        `[arthron] ← ${e.method} ${e.url} ${e.status} ${e.duration}ms`,
      );
    } else {
      logger.error(
        `[arthron] ✕ ${e.method} ${e.url} ${e.status ?? "-"} ${e.duration}ms`,
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
  // The 1.x test hook: ignored, a test's clock would quietly stop applying.
  if ((options as Record<string, unknown>).now !== undefined) {
    throw new TypeError(
      'arthron: logging\'s now option left the public options in 2.0 — mock performance.now in tests (vi.spyOn(performance, "now"))',
    );
  }
  return loggingWith(options, () => performance.now());
}

/** `logging()` with the clock injected — for this package's tests; `arthron/plugins` does not export it. */
export function loggingWith(
  options: LoggingOptions,
  now: () => number,
): Plugin {
  const { enabled = true, logger = console, onEvent } = options;
  const emit = onEvent ?? consoleSink(logger);
  return {
    pluginName: "logging",
    middleware: async (ctx, next) => {
      if (!enabled) return next(ctx);
      const method = ctx.init.method ?? "GET";
      const url = redactUrl(ctx.url);
      const started = now();
      const duration = () => Math.round(now() - started);

      emit({ phase: "start", method, url });
      let res: Response;
      try {
        res = await next(ctx);
      } catch (error) {
        if (!isCancellation(error, ctx.init.signal)) {
          const status = isArthronError(error) ? error.status : undefined;
          emit({
            phase: "error",
            method,
            url,
            status,
            duration: duration(),
            error,
          });
        }
        throw error;
      }
      // Outside the try: a sink that throws is a plugin bug, not a failed request.
      emit({
        phase: "success",
        method,
        url,
        status: res.status,
        duration: duration(),
      });
      return res;
    },
  };
}
