import type {
  NdjsonOptions,
  SseEvent,
  SseOptions,
} from "../types/response.types";

const DEFAULT_LIMIT = 8 * 1024 * 1024;

/**
 * Yield the body line by line, reassembling lines split across chunks. Only
 * the newly arrived text is scanned, so a long line costs linear time; a line
 * past `maxLineLength` stops the stream instead of growing without bound.
 */
async function* lines(
  response: Response,
  maxLineLength: number,
): AsyncGenerator<string> {
  if (!response.body) return;
  const checked = (line: string): string => {
    if (line.length <= maxLineLength) return line;
    throw new RangeError(
      `arthron: a stream line is longer than ${maxLineLength} characters — pass a larger maxLineLength to .sse() / .ndjson() if that is expected`,
    );
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const breaks = /\r\n|\r|\n/g;
  let pending = "";
  // The previous chunk ended in "\r": a "\n" opening this one belongs to it.
  let afterCR = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      let text = decoder.decode(value, { stream: !done });
      if (afterCR && text.startsWith("\n")) {
        text = text.slice(1);
        afterCR = false;
      }
      if (text) afterCR = text.endsWith("\r");
      let start = 0;
      breaks.lastIndex = 0;
      for (let m = breaks.exec(text); m; m = breaks.exec(text)) {
        yield checked(pending + text.slice(start, m.index));
        pending = "";
        start = breaks.lastIndex;
      }
      // Checked before the break arrives too, so a line without one cannot
      // grow without bound.
      pending = checked(pending + text.slice(start));
      if (done) break;
    }
    if (pending) yield pending;
  } finally {
    // Leaving early (break, return, a throw) must close the connection too —
    // releasing the lock alone leaves the body streaming.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Parse a `text/event-stream` body into events. Follows the spec: a blank
 * line dispatches, `data:` lines are joined with `\n`, one leading space
 * after the colon is dropped, lines starting with `:` are comments, and a
 * block without `data` — or one the stream ends inside — is not dispatched.
 * Provider sentinels like
 * `[DONE]` are passed through untouched — they are not part of the spec.
 */
export async function* parseSse(
  response: Response,
  {
    maxLineLength = DEFAULT_LIMIT,
    maxEventSize = DEFAULT_LIMIT,
  }: SseOptions = {},
): AsyncGenerator<SseEvent> {
  let data: string[] = [];
  let size = 0;
  let event: string | undefined;
  let id: string | undefined;
  // Stream state, not block state: neither resets when an event dispatches.
  let lastEventId = "";
  let retry: number | undefined;

  const flush = (): SseEvent | undefined => {
    const out: SseEvent | undefined =
      data.length === 0 ? undefined : { data: data.join("\n"), lastEventId };
    if (out && event !== undefined) out.event = event;
    if (out && id !== undefined) out.id = id;
    if (out && retry !== undefined) out.retry = retry;
    data = [];
    size = 0;
    event = id = undefined;
    return out;
  };

  for await (const line of lines(response, maxLineLength)) {
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
        size += value.length + 1;
        if (size > maxEventSize + 1) {
          throw new RangeError(
            `arthron: an SSE event's data is longer than ${maxEventSize} characters — pass a larger maxEventSize to .sse() if that is expected`,
          );
        }
        data.push(value);
        break;
      case "event":
        event = value;
        break;
      case "id":
        if (!value.includes("\u0000")) id = lastEventId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        break; // unknown fields are ignored, per spec
    }
  }
  // A block the stream ended in before its blank line is incomplete — the
  // spec discards it rather than dispatch a possibly truncated payload.
}

/**
 * Parse newline-delimited JSON. Blank lines are skipped; a malformed line
 * rejects the iteration with the `SyntaxError` from `JSON.parse`.
 */
export async function* parseNdjson<T = unknown>(
  response: Response,
  { maxLineLength = DEFAULT_LIMIT }: NdjsonOptions = {},
): AsyncGenerator<T> {
  for await (const line of lines(response, maxLineLength)) {
    if (line.trim() === "") continue;
    yield JSON.parse(line) as T;
  }
}
