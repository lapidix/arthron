export type TimeoutOptions = {
  /**
   * Abort after this many ms in all, counted until the body has been fully
   * read — the same deadline as `timeout(ms)`. Default: none.
   */
  total?: number;
  /**
   * Abort when no data has arrived for this many ms — while waiting for the
   * headers and between body chunks. Unlike `total`, a stream that keeps
   * flowing is never cut off: `timeout({ idle: 30_000 })`.
   */
  idle?: number;
};
