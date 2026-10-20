import { isReadableStream } from "../../request/body";
import type { Plugin } from "../../types/plugin.types";
import type { RequestContext } from "../../types/request.types";
import { countingFetch } from "./counting-fetch";
import { xhrFetch } from "./xhr-fetch";

/** Node itself — not Bun or Deno, which also expose `process.versions.node`. */
function isNode(): boolean {
  const versions = (
    globalThis as {
      process?: { versions?: Record<string, string | undefined> };
    }
  ).process?.versions;
  return Boolean(versions?.node) && !versions?.bun && !("Deno" in globalThis);
}

/** Options an XHR cannot honour and whose loss would change what the call does. */
function refuseForXhr(init: RequestContext["init"]): void {
  const what =
    init.redirect === "manual" || init.redirect === "error"
      ? `redirect: "${init.redirect}"`
      : init.mode === "no-cors"
        ? 'mode: "no-cors"'
        : undefined;
  if (what) {
    throw new TypeError(
      `arthron: onUploadProgress cannot be combined with ${what} in a browser — progress goes over XMLHttpRequest, which always follows redirects and has no no-cors mode; drop one of them`,
    );
  }
}

/**
 * Does nothing by itself — only a call that passes `meta.onUploadProgress`
 * reports upload progress. On such a call it changes how that one attempt
 * is sent: over XMLHttpRequest in a browser, with a counted body in Node.
 * Every other call, on this client too, goes out exactly as before.
 *
 * Progress needs the runtime's own fetch: with an injected `fetch`, another
 * plugin's transport, or a runtime that is neither (Deno, Bun, a service
 * worker), the call is sent as usual without progress.
 */
export function uploadProgress(): Plugin {
  return {
    name: "uploadProgress",
    request: (ctx) => {
      const onProgress = ctx.meta?.onUploadProgress;
      const { body } = ctx.init;
      if (!onProgress || body === undefined || body === null) return ctx;
      if (ctx.fetch !== globalThis.fetch) return ctx;
      if (typeof XMLHttpRequest === "function") {
        refuseForXhr(ctx.init);
        // XHR cannot send a stream; it goes out as usual, without progress.
        if (isReadableStream(body)) return ctx;
        return { ...ctx, fetch: xhrFetch(onProgress) };
      }
      if (isNode()) {
        return { ...ctx, fetch: countingFetch(ctx.fetch, onProgress) };
      }
      return ctx;
    },
  };
}
