import {
  type FetchedFields,
  withFields,
} from "../../response/rebuild-response";
import type { UploadProgressEvent } from "../../types/request.types";
import { progressEvent } from "./progress-event";
import { headersOf, urlOf } from "./request-parts";

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** `getAllResponseHeaders()` as `Headers`; lines without a name are skipped. */
export function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    if (name) headers.append(name, line.slice(colon + 1).trim());
  }
  return headers;
}

/**
 * What fetch would report for this response. XHR gives only the final URL;
 * the request URL is normalized (case, default port, no fragment) before
 * comparing, so writing it differently is not a redirect.
 */
export function responseFields(
  requestUrl: string,
  responseURL: string,
  pageHref: string | undefined,
): FetchedFields {
  const requested = new URL(requestUrl, pageHref);
  requested.hash = "";
  const final = new URL(responseURL || requested.href, pageHref);
  const sameOrigin =
    pageHref !== undefined && final.origin === new URL(pageHref).origin;
  return {
    url: final.href,
    redirected: final.href !== requested.href,
    type: sameOrigin ? "basic" : "cors",
  };
}

/**
 * A fetch over XMLHttpRequest, for the one thing fetch cannot do in a
 * browser: report upload progress. It honours what an arthron attempt
 * carries — method, headers, body, `credentials: "include"`, `signal` — and
 * fails the way fetch does, so `send` makes the same ArthronErrors: a
 * network failure rejects with a TypeError, an abort with the signal's
 * reason. The response arrives whole; XHR does not stream it.
 */
export function xhrFetch(
  onProgress: (event: UploadProgressEvent) => void,
): typeof fetch {
  return ((input: RequestInfo | URL, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const url = urlOf(input);
      const { signal } = init;
      if (signal?.aborted) return reject(signal.reason);

      const xhr = new XMLHttpRequest();
      let settled = false;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        done();
      };
      const fail = (error: unknown) => {
        settle(() => reject(error));
        xhr.abort();
      };
      const onAbort = () => fail(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });

      let reported: UploadProgressEvent | undefined;
      const report = (loaded: number, total: number | undefined) => {
        if (
          settled ||
          (reported?.loaded === loaded && reported.total === total)
        ) {
          return;
        }
        reported = progressEvent(loaded, total);
        try {
          onProgress(reported);
        } catch (error) {
          // The callback's own error, not a network failure to retry.
          fail(error);
        }
      };
      const fromEvent = (e: ProgressEvent) =>
        report(e.loaded, e.lengthComputable ? e.total : undefined);
      xhr.upload.onprogress = fromEvent;
      // Browsers thin out progress events; the last one says it all went.
      xhr.upload.onload = fromEvent;

      xhr.onload = () => {
        // An empty body fires no upload events: it is done at once.
        if (!reported) report(0, 0);
        if (xhr.status === 0) {
          return settle(() => reject(new TypeError("Network request failed")));
        }
        const headers = parseResponseHeaders(xhr.getAllResponseHeaders());
        const body = NULL_BODY_STATUSES.has(xhr.status) ? null : xhr.response;
        const res = new Response(body, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers,
        });
        const page = (globalThis as { location?: { href?: string } }).location
          ?.href;
        settle(() =>
          resolve(withFields(res, responseFields(url, xhr.responseURL, page))),
        );
      };
      xhr.onerror = xhr.ontimeout = () =>
        settle(() => reject(new TypeError("Network request failed")));

      xhr.open(init.method ?? "GET", url);
      xhr.responseType = "arraybuffer";
      if (init.credentials === "include") xhr.withCredentials = true;
      for (const [name, value] of Object.entries(headersOf(input, init))) {
        xhr.setRequestHeader(name, value);
      }
      xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
    })) as typeof fetch;
}
