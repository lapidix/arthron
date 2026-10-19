export type TimeoutOptions = {
  /**
   * Also abort when no data has arrived for this many ms — while waiting for
   * the headers and between body chunks. Unlike the total deadline, a stream
   * that keeps flowing is never cut off: `timeout(Infinity, { idle: 30_000 })`.
   */
  idle?: number;
};
