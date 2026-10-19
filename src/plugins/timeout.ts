import type { Plugin } from "../types";

/**
 * Abort the attempt when it takes longer than `ms`. Rejects with a
 * `TimeoutError` (a `DOMException`, like `AbortSignal.timeout()` would give) —
 * it is not an `ArthronError`, so error interceptors and `retry` leave it alone.
 *
 * Built on `AbortController` + `setTimeout` rather than `AbortSignal.any` /
 * `AbortSignal.timeout` so it runs on Node 18.
 */
export function timeout(ms: number): Plugin {
  return {
    name: "timeout",
    middleware: async (ctx, next) => {
      const controller = new AbortController();
      const outer = ctx.init.signal;
      const forward = () => controller.abort(outer?.reason);
      if (outer?.aborted) forward();
      else outer?.addEventListener("abort", forward, { once: true });

      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException(
              `arthron: request timed out after ${ms}ms`,
              "TimeoutError",
            ),
          ),
        ms,
      );
      try {
        return await next({
          ...ctx,
          init: { ...ctx.init, signal: controller.signal },
        });
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", forward);
      }
    },
  };
}
