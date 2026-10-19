import type { Plugin } from "../types";

/**
 * Wrap `body` so the deadline keeps running until it is fully read, and so an
 * abort while reading surfaces as a stream error instead of a silent stall.
 */
function guardBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  finish: () => void,
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
      controller.enqueue(value);
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
}

/**
 * Abort the request when it takes longer than `ms` — counted from the start
 * of the attempt until the body has been fully read, so a server that sends
 * headers and then stalls still trips it. Rejects with a `TimeoutError` (a
 * `DOMException`, like `AbortSignal.timeout()` would give); it is not an
 * `ArthronError`, so error interceptors and `retry` leave it alone.
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
      const finish = () => {
        clearTimeout(timer);
        outer?.removeEventListener("abort", forward);
      };

      let res: Response;
      try {
        res = await next({
          ...ctx,
          init: { ...ctx.init, signal: controller.signal },
        });
      } catch (thrown) {
        finish();
        throw thrown;
      }
      if (!res.body) {
        finish();
        return res;
      }
      return new Response(guardBody(res.body, controller.signal, finish), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    },
  };
}
