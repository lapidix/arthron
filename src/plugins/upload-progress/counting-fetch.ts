import { tagOf } from "../../request/body";
import type { UploadProgressEvent } from "../../types/request.types";
import { progressEvent } from "./progress-event";
import { headersOf } from "./request-parts";

/**
 * The most one progress step covers. Chunks are cut to it whatever their
 * source: Node hands an in-memory Blob over as a single chunk, which would
 * jump from 0 to 100%.
 */
const SLICE = 64 * 1024;

type Source = {
  stream: ReadableStream<Uint8Array>;
  total: number | undefined;
  /** The content-type fetch would have derived from the body itself. */
  type: string | undefined;
};

const fromBytes = (bytes: Uint8Array, type?: string | null): Source => ({
  // One chunk; the counting stream cuts it into SLICE-sized steps.
  stream: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }),
  total: bytes.byteLength,
  type: type ?? undefined,
});

/** The body as bytes to count, or `undefined` for none (or one fetch should get as is). */
async function sourceOf(
  body: unknown,
  headers: Record<string, string>,
): Promise<Source | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    return fromBytes(
      new TextEncoder().encode(body),
      "text/plain;charset=UTF-8",
    );
  }
  if (ArrayBuffer.isView(body)) {
    return fromBytes(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  switch (tagOf(body)) {
    case "Blob":
    case "File": {
      const blob = body as Blob;
      return {
        stream: blob.stream(),
        total: blob.size,
        type: blob.type || undefined,
      };
    }
    case "ArrayBuffer":
      return fromBytes(new Uint8Array(body as ArrayBuffer));
    case "URLSearchParams":
      return fromBytes(
        new TextEncoder().encode(String(body)),
        "application/x-www-form-urlencoded;charset=UTF-8",
      );
    case "FormData": {
      // The multipart encoding is the runtime's; its length is known only once built.
      const encoded = new Response(body as FormData);
      const bytes = new Uint8Array(await encoded.arrayBuffer());
      return fromBytes(bytes, encoded.headers.get("content-type"));
    }
    case "ReadableStream": {
      const length = Number(headers["content-length"]);
      return {
        stream: body as ReadableStream<Uint8Array>,
        total: Number.isSafeInteger(length) && length >= 0 ? length : undefined,
        type: undefined,
      };
    }
    default:
      return undefined;
  }
}

/**
 * `base` with the request body counted as it is read. The body is swapped
 * here, inside the call, so the context the plugins see keeps the caller's
 * own. A callback that throws fails the call with its own error, not the
 * "fetch failed" the body error would become.
 */
export function countingFetch(
  base: typeof fetch,
  onProgress: (event: UploadProgressEvent) => void,
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = headersOf(input, init);
    const source = await sourceOf(init.body, headers);
    if (!source) return base(input, init);
    const { total, type } = source;
    if (total !== undefined && !("content-length" in headers)) {
      headers["content-length"] = String(total);
    }
    if (type && !("content-type" in headers)) headers["content-type"] = type;

    const signal = init.signal;
    const reader = source.stream.getReader();
    let loaded = 0;
    // What is left of a chunk longer than SLICE.
    let rest: Uint8Array | undefined;
    let reported = false;
    // Once the response is in, the server has answered: no more progress.
    let answered = false;
    let failure: { error: unknown } | undefined;
    const report = () => {
      if (answered) return;
      reported = true;
      try {
        onProgress(progressEvent(loaded, total));
      } catch (error) {
        failure = { error };
        throw error;
      }
    };
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const stopped = async () => {
            if (!signal?.aborted) return false;
            await reader.cancel(signal.reason).catch(() => {});
            controller.error(signal.reason);
            return true;
          };
          if (await stopped()) return;
          let chunk = rest;
          if (!chunk?.byteLength) {
            const { value, done } = await reader.read();
            if (done) {
              // An empty body still says it is done, once.
              if (!reported) report();
              return controller.close();
            }
            chunk = value;
            // The abort may have come while that read was pending.
            if (await stopped()) return;
          }
          rest = chunk.subarray(SLICE);
          const piece = chunk.subarray(0, SLICE);
          loaded += piece.byteLength;
          report();
          controller.enqueue(piece);
        },
        cancel: (reason) => reader.cancel(reason),
      },
      { highWaterMark: 0 },
    );
    try {
      const res = await base(input, {
        ...init,
        body,
        headers,
        duplex: "half",
      } as RequestInit);
      answered = true;
      return res;
    } catch (error) {
      throw failure ? failure.error : error;
    }
  }) as typeof fetch;
}
