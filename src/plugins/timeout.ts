import { rebuildResponse } from "../response/rebuild-response";
import type { Plugin } from "../types/plugin.types";
import type { TimeoutOptions } from "./timeout.types";

const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Wrap `body` so the deadline keeps running until it is fully read, and so an
 * abort while reading surfaces as a stream error instead of a silent stall.
 */
function guardBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  finish: () => void,
  onChunk: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener(
        "abort",
        () => {
          controller.error(signal.reason);
          reader.cancel(signal.reason).catch(() => {});
        },
        { once: true },
      );
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        finish();
        controller.close();
        return;
      }
      onChunk();
      controller.enqueue(value);
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
}

/** setTimeout fires at once for NaN, negatives and anything past 2^31-1. */
function checkDeadline(ms: number, where: string): void {
  if (ms === Number.POSITIVE_INFINITY || (ms >= 0 && ms <= MAX_TIMER_MS))
    return;
  throw new TypeError(
    `arthron: ${where} needs 0–${MAX_TIMER_MS} ms — pass Infinity for no deadline`,
  );
}

/** A timer that aborts `controller` with a TimeoutError and never keeps Node alive on its own. */
function deadlineTimer(
  controller: AbortController,
  ms: number,
  message: string,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(
    () => controller.abort(new DOMException(message, "TimeoutError")),
    ms,
  );
  (timer as { unref?: () => unknown }).unref?.();
  return timer;
}

/**
 * Abort the request when it takes longer than `ms` — counted from the start
 * of the attempt until the body has been fully read, so a server that sends
 * headers and then stalls still trips it. With `idle`, also abort once no
 * data has arrived for that long. Rejects with a `TimeoutError` (a
 * `DOMException`, like `AbortSignal.timeout()` would give); it is not an
 * `ArthronError`, so error interceptors and `retry` leave it alone.
 *
 * A call can change the total deadline with `meta.timeout`.
 *
 * Deadlines are timers on an AbortController — not `AbortSignal.timeout`,
 * since the idle one restarts — joined to the caller's signal with
 * `AbortSignal.any`.
 */
export function timeout(ms: number, options: TimeoutOptions = {}): Plugin {
  checkDeadline(ms, `timeout(${ms})`);
  const { idle } = options;
  if (idle !== undefined) checkDeadline(idle, `timeout(…, { idle: ${idle} })`);
  return {
    name: "timeout",
    middleware: async (ctx, next) => {
      const deadline = ctx.meta?.timeout ?? ms;
      if (deadline !== ms) checkDeadline(deadline, `meta.timeout: ${deadline}`);
      const idleMs = idle === Number.POSITIVE_INFINITY ? undefined : idle;
      if (deadline === Number.POSITIVE_INFINITY && idleMs === undefined) {
        return next(ctx);
      }
      const controller = new AbortController();
      const outer = ctx.init.signal;
      // The caller's abort and our deadlines, as one signal.
      const signal = outer
        ? AbortSignal.any([outer, controller.signal])
        : controller.signal;

      const total =
        deadline === Number.POSITIVE_INFINITY
          ? undefined
          : deadlineTimer(
              controller,
              deadline,
              `arthron: request timed out after ${deadline}ms`,
            );
      let quiet: ReturnType<typeof setTimeout> | undefined;
      // Restarted whenever something arrives: the headers, then every chunk.
      const stillAlive = () => {
        if (idleMs === undefined) return;
        clearTimeout(quiet);
        quiet = deadlineTimer(
          controller,
          idleMs,
          `arthron: no data for ${idleMs}ms`,
        );
      };
      const finish = () => {
        clearTimeout(total);
        clearTimeout(quiet);
      };
      stillAlive();

      let res: Response;
      try {
        res = await next({
          ...ctx,
          init: { ...ctx.init, signal },
        });
      } catch (thrown) {
        finish();
        throw thrown;
      }
      if (!res.body) {
        finish();
        return res;
      }
      stillAlive();
      return rebuildResponse(
        res,
        guardBody(res.body, signal, finish, stillAlive),
      );
    },
  };
}
