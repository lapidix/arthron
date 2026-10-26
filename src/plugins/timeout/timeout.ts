import { rebuildResponse } from "../../response/rebuild-response";
import type { Plugin } from "../../types/plugin.types";
import type { ArthronMeta, TimeoutOptions } from "../../types/request.types";

const MAX_TIMER_MS = 2 ** 31 - 1;

/** The idle deadline, started while a read waits on the server and stopped when data comes. */
type IdleTimer = { start: () => void; stop: () => void };

/**
 * Wrap `body` so the deadline keeps running until it is fully read, and so an
 * abort while reading surfaces as a stream error instead of a silent stall.
 * The idle deadline runs only while a read waits on the source: the time the
 * caller takes between reads is not the server going quiet.
 */
function guardBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  finish: () => void,
  idle: IdleTimer,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let onAbort = () => {};
  // The listener goes when the body does: left on a signal joined to the
  // caller's, it would keep this reader alive as long as the caller's signal.
  const release = () => {
    signal.removeEventListener("abort", onAbort);
    finish();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        controller.error(signal.reason);
        release();
        void reader.cancel(signal.reason).catch(() => {});
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      idle.start();
      try {
        chunk = await reader.read();
      } catch (error) {
        release();
        throw error;
      }
      if (chunk.done) {
        release();
        controller.close();
        return;
      }
      idle.stop();
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      release();
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

/** `timeout(ms)` or `timeout({ total, idle })`, checked. */
function resolveTimeoutOptions(first: number | TimeoutOptions): {
  ms: number;
  idle: number | undefined;
} {
  if (typeof first === "number") {
    checkDeadline(first, `timeout(${first})`);
    return { ms: first, idle: undefined };
  }
  const { total, idle } = first;
  if (total === undefined && idle === undefined) {
    throw new TypeError(
      "arthron: timeout({}) needs total or idle — e.g. timeout({ total: 10_000 }) or timeout({ idle: 30_000 })",
    );
  }
  if (total !== undefined) checkDeadline(total, `timeout({ total: ${total} })`);
  if (idle !== undefined) checkDeadline(idle, `timeout({ idle: ${idle} })`);
  return { ms: total ?? Number.POSITIVE_INFINITY, idle };
}

/** One call's deadlines: the plugin's, with `meta.timeout` applied and checked. */
function forCall(
  base: { ms: number; idle: number | undefined },
  override: ArthronMeta["timeout"],
): { ms: number; idle: number | undefined } {
  if (override === undefined) return base;
  if (override === false) {
    return { ms: Number.POSITIVE_INFINITY, idle: undefined };
  }
  if (typeof override === "number") {
    checkDeadline(override, `meta.timeout: ${override}`);
    return { ...base, ms: override };
  }
  const { total, idle } = override;
  if (total !== undefined) {
    checkDeadline(total, `meta.timeout: { total: ${total} }`);
  }
  if (idle !== undefined)
    checkDeadline(idle, `meta.timeout: { idle: ${idle} }`);
  return { ms: total ?? base.ms, idle: idle ?? base.idle };
}

/**
 * Abort the request when it takes longer than `ms` — counted from the start
 * of the attempt until the body has been fully read, so a server that sends
 * headers and then stalls still trips it. `timeout({ idle })` instead aborts
 * once no data has arrived for that long, and never cuts off a stream that
 * keeps flowing; `timeout({ total, idle })` does both. Rejects with a
 * `TimeoutError` (a `DOMException`, like `AbortSignal.timeout()` would give);
 * it is not an `ArthronError`, so error interceptors and `retry` leave it
 * alone.
 *
 * A call can lift the deadlines or change them with `meta.timeout`.
 *
 * Deadlines are timers on an AbortController — not `AbortSignal.timeout`,
 * since the idle one restarts — joined to the caller's signal with
 * `AbortSignal.any`.
 */
export function timeout(ms: number): Plugin;
export function timeout(options: TimeoutOptions): Plugin;
export function timeout(
  first: number | TimeoutOptions,
  removed?: unknown,
): Plugin {
  // The 1.x `timeout(ms, { idle })`: from JS it would drop idle silently.
  // Only an object: `[5000].map(timeout)` passes the index second.
  if (typeof removed === "object" && removed !== null) {
    throw new TypeError(
      "arthron: timeout(ms, { idle }) was removed in 2.0 — pass one object, timeout({ total: ms, idle })",
    );
  }
  const base = resolveTimeoutOptions(first);
  return {
    pluginName: "timeout",
    middleware: async (ctx, next) => {
      const { ms: deadline, idle } = forCall(base, ctx.meta?.timeout);
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
      // Runs while we wait on the server: for the headers, then for each
      // chunk a read asks for.
      const idleTimer: IdleTimer = {
        start: () => {
          if (idleMs === undefined) return;
          clearTimeout(quiet);
          quiet = deadlineTimer(
            controller,
            idleMs,
            `arthron: no data for ${idleMs}ms`,
          );
        },
        stop: () => clearTimeout(quiet),
      };
      const finish = () => {
        clearTimeout(total);
        idleTimer.stop();
      };
      idleTimer.start();

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
      idleTimer.stop();
      return rebuildResponse(
        res,
        guardBody(res.body, signal, finish, idleTimer),
      );
    },
  };
}
