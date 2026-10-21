type LogEventBase = { method: string; path: string };
export type LogEvent =
  | ({ phase: "start" } & LogEventBase)
  | ({ phase: "success"; status: number; ms: number } & LogEventBase)
  | ({
      phase: "error";
      /** HTTP status for an ArthronError (0 = network); undefined for anything else. */
      status: number | undefined;
      ms: number;
      error: unknown;
    } & LogEventBase);

export type LoggingOptions = {
  /** Default `true`. The library never reads `NODE_ENV` — pass `isDev` yourself. */
  enabled?: boolean;
  logger?: Pick<Console, "log" | "error">;
  /** Receive structured events instead of the default console lines. */
  onEvent?: (event: LogEvent) => void;
};
