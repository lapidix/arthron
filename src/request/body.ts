type Serialized = {
  body: BodyInit | undefined;
  headers: Record<string, string>;
};

const RAW_TAGS = new Set([
  "FormData",
  "Blob",
  "File",
  "ArrayBuffer",
  "URLSearchParams",
  "ReadableStream",
]);

/**
 * `Symbol.toStringTag`, not `instanceof`: a body from another realm or a
 * polyfill (formdata-node, fetch-blob) must not be JSON-encoded into `{}`.
 */
export const tagOf = (value: unknown): string =>
  Object.prototype.toString.call(value).slice(8, -1);

export function isReadableStream(value: unknown): value is ReadableStream {
  return tagOf(value) === "ReadableStream";
}

/**
 * Whether `RequestCtor` can send a ReadableStream body. Node and Chromium
 * read `duplex` and leave the stream alone; Firefox ignores `duplex` and
 * would send the text "[object ReadableStream]"; older Safari refuses it.
 * The check from
 * https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests
 */
export function canStreamRequestBody(RequestCtor: typeof Request): boolean {
  let duplexRead = false;
  try {
    const request = new RequestCtor("https://stream.test", {
      method: "POST",
      body: new ReadableStream(),
      get duplex() {
        duplexRead = true;
        return "half";
      },
    } as RequestInit);
    return duplexRead && !request.headers.has("content-type");
  } catch {
    return false;
  }
}

let runtimeStreams: boolean | undefined;

/** `canStreamRequestBody` for the global `Request`, checked once. */
export function runtimeStreamsRequestBody(): boolean {
  runtimeStreams ??=
    typeof Request !== "function" || canStreamRequestBody(Request);
  return runtimeStreams;
}

/**
 * What JSON.stringify would turn into `{}`, `undefined` or internal state
 * instead of the data — with the fix, so it reads as an error message.
 */
function mangledByJson(body: unknown): string | undefined {
  if (typeof body === "function" || typeof body === "symbol") {
    return `a ${typeof body}, which JSON cannot carry — send its data instead`;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  if (Symbol.asyncIterator in body) {
    return "an async iterable (a Node stream?) — pass a ReadableStream (Readable.toWeb(stream)) or collect it first";
  }
  if (Symbol.iterator in body) {
    return "an iterable such as a Map, Set or generator — convert it to an array or plain object first";
  }
  return undefined;
}

/** Bodies fetch already knows how to send. Content-Type is left to the caller / runtime. */
function isRawBody(body: unknown): body is BodyInit {
  if (typeof body === "string") return true;
  if (ArrayBuffer.isView(body)) return true;
  return RAW_TAGS.has(tagOf(body));
}

/**
 * Turn a caller-supplied body into something fetch accepts. Raw bodies pass
 * through untouched; anything else is JSON with `content-type` set — unless
 * the caller already set one (headers arrive lowercased, so a plain lookup is
 * enough).
 */
export function serializeBody(
  body: unknown,
  headers: Record<string, string>,
): Serialized {
  if (body === undefined) return { body: undefined, headers };
  if (tagOf(body) === "FormData") {
    // The runtime must write `multipart/form-data; boundary=…` itself; any
    // content-type set here (a JSON default, typically) breaks the upload.
    const { "content-type": _dropped, ...rest } = headers;
    return { body: body as FormData, headers: rest };
  }
  if (isRawBody(body)) return { body, headers };
  const mangled = mangledByJson(body);
  if (mangled) {
    throw new TypeError(`arthron: the body is ${mangled}`);
  }
  const type = headers["content-type"];
  if (type !== undefined && !/\bjson\b/i.test(type)) {
    throw new TypeError(
      `arthron: a ${typeof body} body is sent as JSON, but content-type is "${type}" — pass a string, URLSearchParams or FormData for that content type, or drop the header`,
    );
  }
  const withType =
    "content-type" in headers
      ? headers
      : { ...headers, "content-type": "application/json" };
  return { body: JSON.stringify(body), headers: withType };
}
