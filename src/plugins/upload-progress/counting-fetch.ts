import { tagOf } from "../../request/body";
import type { UploadProgressEvent } from "../../types/request.types";
import { progressEvent } from "./progress-event";

/** How much of an in-memory body each read hands over. */
const SLICE = 64 * 1024;

type Source = {
  stream: ReadableStream<Uint8Array>;
  total: number | undefined;
  /** The content-type fetch would have derived from the body itself. */
  type: string | undefined;
};

function sliced(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.byteLength) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset + SLICE));
        offset += SLICE;
      },
    },
    { highWaterMark: 0 },
  );
}

const fromBytes = (bytes: Uint8Array, type?: string | null): Source => ({
  stream: sliced(bytes),
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
    const headers = { ...(init.headers as Record<string, string> | undefined) };
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
    let reported = false;
    let failure: { error: unknown } | undefined;
    const report = () => {
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
          if (signal?.aborted) {
            await reader.cancel(signal.reason).catch(() => {});
            return controller.error(signal.reason);
          }
          const { value, done } = await reader.read();
          if (done) {
            // An empty body still says it is done, once.
            if (!reported) report();
            return controller.close();
          }
          loaded += value.byteLength;
          report();
          controller.enqueue(value);
        },
        cancel: (reason) => reader.cancel(reason),
      },
      { highWaterMark: 0 },
    );
    try {
      return await base(input, {
        ...init,
        body,
        headers,
        duplex: "half",
      } as RequestInit);
    } catch (error) {
      throw failure ? failure.error : error;
    }
  }) as typeof fetch;
}
