import { isReadableStream } from "../../request/body";
import type { Plugin } from "../../types/plugin.types";
import type {
  RequestContext,
  UploadProgressEvent,
} from "../../types/request.types";
import { countingFetch } from "./counting-fetch";
import { xhrFetch } from "./xhr-fetch";

type Runtime = {
  versions?: Readonly<Record<string, string | undefined>>;
  hasXhr: boolean;
  userAgent?: string;
  deno?: boolean;
};

/**
 * How a progress call can be sent here. Node first — jsdom on Node has an
 * XMLHttpRequest too, but Node's fetch is the real transport there. Bun,
 * Deno, Electron and Cloudflare Workers also expose `process.versions.node`;
 * only Node was shown to keep content-length on a counted body, and an
 * Electron renderer has XHR.
 */
export function transportFor(runtime: Runtime): "count" | "xhr" | undefined {
  const { versions, hasXhr, userAgent, deno } = runtime;
  const node =
    Boolean(versions?.node) &&
    !versions?.bun &&
    !versions?.electron &&
    !deno &&
    userAgent !== "Cloudflare-Workers";
  if (node) return "count";
  return hasXhr ? "xhr" : undefined;
}

function currentRuntime(): Runtime {
  const g = globalThis as {
    process?: { versions?: Record<string, string | undefined> };
    navigator?: { userAgent?: string };
  };
  const runtime: Runtime = {
    hasXhr: typeof XMLHttpRequest === "function",
    deno: "Deno" in globalThis,
  };
  if (g.process?.versions) runtime.versions = g.process.versions;
  if (g.navigator?.userAgent) runtime.userAgent = g.navigator.userAgent;
  return runtime;
}

/**
 * What an XHR cannot honour and whose loss would change the call: it always
 * follows redirects, has no no-cors mode, and always sends cookies to its own
 * origin. `undefined` when the call can go over XHR.
 */
export function xhrRefusal(
  init: Pick<RequestInit, "redirect" | "mode" | "credentials">,
  url: string,
  pageHref: string | undefined,
): string | undefined {
  if (init.redirect === "manual" || init.redirect === "error") {
    return `redirect: "${init.redirect}" — XMLHttpRequest always follows redirects`;
  }
  if (init.mode === "no-cors") {
    return 'mode: "no-cors" — XMLHttpRequest has no no-cors mode';
  }
  if (init.credentials === "omit" && pageHref) {
    const page = new URL(pageHref).origin;
    if (new URL(url, pageHref).origin === page) {
      return 'credentials: "omit" on this origin — XMLHttpRequest always sends cookies to its own origin';
    }
  }
  return undefined;
}

/**
 * The attempt with its own signal, joined to the call's. A callback that
 * throws aborts the attempt with its error: send passes an abort reason on
 * untouched, so it stays a plugin exception — not a network ArthronError
 * that error interceptors would see and retry would repeat.
 */
function withOwnSignal(
  ctx: RequestContext,
  onProgress: (event: UploadProgressEvent) => void,
): { ctx: RequestContext; report: (event: UploadProgressEvent) => void } {
  const own = new AbortController();
  const outer = ctx.init.signal;
  const signal = outer ? AbortSignal.any([outer, own.signal]) : own.signal;
  const report = (event: UploadProgressEvent) => {
    if (own.signal.aborted) return;
    try {
      onProgress(event);
    } catch (error) {
      own.abort(error);
    }
  };
  return { ctx: { ...ctx, init: { ...ctx.init, signal } }, report };
}

/**
 * Does nothing by itself — only a call that passes `meta.uploadProgress`
 * reports upload progress. On such a call it changes how that one attempt
 * is sent: over XMLHttpRequest in a browser, with a counted body in Node.
 * Every other call, on this client too, goes out exactly as before.
 *
 * Progress needs the runtime's own fetch: with an injected `fetch`, another
 * plugin's fetchFn, or a runtime that is neither (Deno, Bun, Cloudflare
 * Workers, a service worker), the call is sent as usual without progress.
 * Put it last in `use`: the call's signal carries a throwing callback's
 * error, and an interceptor after it that replaces the signal would cut it.
 */
export function uploadProgress(): Plugin {
  return {
    pluginName: "uploadProgress",
    requestInterceptor: (ctx) => {
      const onProgress = ctx.meta?.uploadProgress;
      const { body } = ctx.init;
      if (!onProgress || body === undefined || body === null) return ctx;
      if (ctx.fetchFn !== globalThis.fetch) return ctx;
      const transport = transportFor(currentRuntime());
      if (!transport) return ctx;
      if (transport === "xhr") {
        const page = (globalThis as { location?: { href?: string } }).location
          ?.href;
        const refusal = xhrRefusal(ctx.init, ctx.url, page);
        if (refusal) {
          throw new TypeError(
            `arthron: meta.uploadProgress cannot be combined with ${refusal}; drop one of them`,
          );
        }
        // XHR cannot send a stream; it goes out as usual, without progress.
        if (isReadableStream(body)) return ctx;
      }
      const { ctx: next, report } = withOwnSignal(ctx, onProgress);
      return {
        ...next,
        fetchFn:
          transport === "xhr"
            ? xhrFetch(report)
            : countingFetch(ctx.fetchFn, report),
      };
    },
  };
}
