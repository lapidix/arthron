type Serialized = {
  body: BodyInit | undefined;
  headers: Record<string, string>;
};

const RAW_CTORS = [
  "FormData",
  "Blob",
  "ArrayBuffer",
  "URLSearchParams",
  "ReadableStream",
] as const;

/** Bodies fetch already knows how to send. Content-Type is left to the caller / runtime. */
function isRawBody(body: unknown): body is BodyInit {
  if (typeof body === "string") return true;
  if (ArrayBuffer.isView(body)) return true;
  return RAW_CTORS.some((name) => {
    const ctor = (globalThis as Record<string, unknown>)[name];
    return typeof ctor === "function" && body instanceof ctor;
  });
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
  if (isRawBody(body)) return { body, headers };
  const withType =
    "content-type" in headers
      ? headers
      : { ...headers, "content-type": "application/json" };
  return { body: JSON.stringify(body), headers: withType };
}
