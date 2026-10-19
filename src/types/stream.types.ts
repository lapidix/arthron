/** One server-sent event, as described by the WHATWG EventSource spec. */
export type SseEvent = {
  /** The `event:` field, when the server sent one. */
  event?: string;
  /** All `data:` lines of the block, joined with `\n`. */
  data: string;
  /** The `id:` field of this event's own block, when it had one. */
  id?: string;
  /**
   * The last event ID so far, as EventSource's `lastEventId`: it persists
   * across events (a block with only `id:` updates it too) and is "" until
   * the server sends one. Send it as `Last-Event-ID` to resume a stream.
   */
  lastEventId: string;
  /** The reconnection time in ms the server last set with `retry:`; carried on every event after it. */
  retry?: number;
};

export type NdjsonOptions = {
  /**
   * Longest line accepted, in characters. A longer one rejects the iteration
   * with a RangeError and cancels the body. Default 8 Mi.
   */
  maxLineLength?: number;
};

export type SseOptions = NdjsonOptions & {
  /**
   * Most `data` one event may collect before its blank line, in characters.
   * More rejects the iteration with a RangeError and cancels the body.
   * Default 8 Mi.
   */
  maxEventSize?: number;
};
