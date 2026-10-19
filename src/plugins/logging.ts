import { isCancellation, isIeumError } from "../error";
import type { Plugin } from "../types";

export type LoggingOptions = {
  /** Default `true`. The library never reads `NODE_ENV` — pass `isDev` yourself. */
  enabled?: boolean;
  logger?: Pick<Console, "log" | "error">;
  /** Clock in ms. Injectable for tests. */
  now?: () => number;
};

/**
 * One line when a request starts, one when it settles, with status and
 * elapsed time. Wraps the whole call, so retries are included in the time.
 * The query string is dropped — it tends to carry tokens.
 */
export function logging(options: LoggingOptions = {}): Plugin {
  const {
    enabled = true,
    logger = console,
    now = () => performance.now(),
  } = options;
  return {
    name: "logging",
    middleware: async (ctx, next) => {
      if (!enabled) return next(ctx);
      const method = ctx.init.method ?? "GET";
      const path = ctx.url.split("?")[0];
      const started = now();
      const elapsed = () => `${Math.round(now() - started)}ms`;

      logger.log(`[ieum] → ${method} ${path}`);
      try {
        const res = await next(ctx);
        logger.log(`[ieum] ← ${method} ${path} ${res.status} ${elapsed()}`);
        return res;
      } catch (thrown) {
        if (!isCancellation(thrown)) {
          const status = isIeumError(thrown) ? thrown.status : "-";
          logger.error(`[ieum] ✕ ${method} ${path} ${status} ${elapsed()}`);
        }
        throw thrown;
      }
    },
  };
}
