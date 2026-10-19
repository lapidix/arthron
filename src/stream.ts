/** One server-sent event, as described by the WHATWG EventSource spec. */
export type SseEvent = {
  /** The `event:` field, when the server sent one. */
  event?: string;
  /** All `data:` lines of the block, joined with `\n`. */
  data: string;
  /** The `id:` field, when present. */
  id?: string;
  /** The `retry:` field in ms, when present and numeric. */
  retry?: number;
};

/** Yield the body line by line, reassembling lines split across chunks. */
async function* lines(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parts = buffer.split(/\r\n|\r|\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) yield line;
      if (done) break;
    }
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a `text/event-stream` body into events. Follows the spec: a blank
 * line dispatches, `data:` lines are joined with `\n`, one leading space
 * after the colon is dropped, lines starting with `:` are comments, and a
 * block without `data` is not dispatched. Provider sentinels like
 * `[DONE]` are passed through untouched — they are not part of the spec.
 */
export async function* parseSse(response: Response): AsyncGenerator<SseEvent> {
  let data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  const flush = (): SseEvent | undefined => {
    if (data.length === 0) {
      event = id = retry = undefined;
      return undefined;
    }
    const out: SseEvent = { data: data.join("\n") };
    if (event !== undefined) out.event = event;
    if (id !== undefined) out.id = id;
    if (retry !== undefined) out.retry = retry;
    data = [];
    event = id = retry = undefined;
    return out;
  };

  for await (const line of lines(response)) {
    if (line === "") {
      const out = flush();
      if (out) yield out;
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        data.push(value);
        break;
      case "event":
        event = value;
        break;
      case "id":
        id = value;
        break;
      case "retry": {
        const ms = Number(value);
        if (Number.isInteger(ms) && ms >= 0) retry = ms;
        break;
      }
      default:
        break; // unknown fields are ignored, per spec
    }
  }
  const out = flush();
  if (out) yield out;
}

/**
 * Parse newline-delimited JSON. Blank lines are skipped; a malformed line
 * rejects the iteration with the `SyntaxError` from `JSON.parse`.
 */
export async function* parseNdjson<T = unknown>(
  response: Response,
): AsyncGenerator<T> {
  for await (const line of lines(response)) {
    if (line.trim() === "") continue;
    yield JSON.parse(line) as T;
  }
}
