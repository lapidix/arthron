import { isArthronError, isCancellation } from "../error";
import type { Plugin } from "../types";

type LogEventBase = { method: string; path: string };
export type LogEvent =
  | ({ phase: "start" } & LogEventBase)
  | ({ phase: "success"; status: number; ms: number } & LogEventBase)
  | ({
      phase: "error";
      /** HTTP status for an ArthronError (0 = network); undefined for anything else. */
      status: number | undefined;
      ms: number;
      error: unknown;
    } & LogEventBase);

export type LoggingOptions = {
  /** Default `true`. The library never reads `NODE_ENV` — pass `isDev` yourself. */
  enabled?: boolean;
  logger?: Pick<Console, "log" | "error">;
  /** Receive structured events instead of the default console lines. */
  onEvent?: (event: LogEvent) => void;
  /** Clock in ms. Injectable for tests. */
  now?: () => number;
};

/** Origin + pathname only — the query and userinfo tend to carry secrets. */
function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

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
      const path = displayPath(ctx.url);
      const started = now();
      const ms = () => Math.round(now() - started);

      emit({ phase: "start", method, path });
      try {
        const res = await next(ctx);
        emit({ phase: "success", method, path, status: res.status, ms: ms() });
        return res;
      } catch (error) {
        if (!isCancellation(error)) {
          const status = isArthronError(error) ? error.status : undefined;
          emit({ phase: "error", method, path, status, ms: ms(), error });
        }
        throw error;
      }
    },
  };
}
