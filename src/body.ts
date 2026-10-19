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
const tagOf = (value: unknown): string =>
  Object.prototype.toString.call(value).slice(8, -1);

export function isReadableStream(value: unknown): value is ReadableStream {
  return tagOf(value) === "ReadableStream";
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
  const withType =
    "content-type" in headers
      ? headers
      : { ...headers, "content-type": "application/json" };
  return { body: JSON.stringify(body), headers: withType };
}
