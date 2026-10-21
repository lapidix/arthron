/**
 * One step of a call, as `logging({ onEvent })` receives it. `url` is the
 * request URL with its query and userinfo removed — the value
 * `ArthronError.toJSON()` calls `url`. `duration` is in ms, retries
 * included.
 */
export type LogEvent =
  | { phase: "start"; method: string; url: string }
  | {
      phase: "success";
      method: string;
      url: string;
      status: number;
      duration: number;
    }
  | {
      phase: "error";
      method: string;
      url: string;
      /** HTTP status for an ArthronError (0 = network); undefined for anything else. */
      status: number | undefined;
      duration: number;
      error: unknown;
    };

export type LoggingOptions = {
  /** Default `true`. The library never reads `NODE_ENV` — pass `isDev` yourself. */
  enabled?: boolean;
  logger?: Pick<Console, "log" | "error">;
  /** Receive structured events instead of the default console lines. */
  onEvent?: (event: LogEvent) => void;
};
