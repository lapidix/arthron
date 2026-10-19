import { describe, expect, it, vi } from "vitest";
import { networkError } from "../error";
import { runPipeline } from "../pipeline";
import { jsonResponse } from "../test-utils";
import { type LogEvent, logging } from "./logging";

const ctx = { url: "https://a/u?secret=1", init: { method: "POST" } };
const clock = () => {
  let t = 0;
  return { now: () => (t += 12) };
};
const spyLogger = () => ({ log: vi.fn(), error: vi.fn() });

describe("logging", () => {
  it("logs start and success without the query string", async () => {
    const logger = spyLogger();
    await runPipeline([logging({ logger, ...clock() })], ctx, async () =>
      jsonResponse({}, { status: 201 }),
    );
    expect(logger.log.mock.calls).toEqual([
      ["[arthron] → POST https://a/u"],
      ["[arthron] ← POST https://a/u 201 12ms"],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });
  it("logs failures with status and rethrows", async () => {
    const logger = spyLogger();
    await expect(
      runPipeline([logging({ logger, ...clock() })], ctx, async (c) => {
        throw networkError(new Error("x"), c);
      }),
    ).rejects.toMatchObject({ status: 0 });
    expect(logger.error).toHaveBeenCalledWith(
      "[arthron] ✕ POST https://a/u 0 12ms",
    );
  });
  it("logs non-ArthronError failures with '-' for status", async () => {
    const logger = spyLogger();
    await expect(
      runPipeline([logging({ logger, ...clock() })], ctx, async () => {
        throw new RangeError("bug");
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(logger.error).toHaveBeenCalledWith(
      "[arthron] ✕ POST https://a/u - 12ms",
    );
  });
  it("does not log cancellations", async () => {
    const logger = spyLogger();
    const abort = new DOMException("a", "AbortError");
    await expect(
      runPipeline([logging({ logger })], ctx, async () => {
        throw abort;
      }),
    ).rejects.toBe(abort);
    expect(logger.error).not.toHaveBeenCalled();
  });
  it("does not log an abort with a custom reason", async () => {
    const logger = spyLogger();
    const reason = new Error("navigated away");
    const ac = new AbortController();
    ac.abort(reason);
    await expect(
      runPipeline(
        [logging({ logger })],
        { url: "https://a/u", init: { signal: ac.signal } },
        async () => {
          throw reason;
        },
      ),
    ).rejects.toBe(reason);
    expect(logger.error).not.toHaveBeenCalled();
  });
  it("a sink that throws on success does not also report the request as failed", async () => {
    const phases: string[] = [];
    const sinkBug = new Error("sink down");
    const onEvent = (e: LogEvent) => {
      phases.push(e.phase);
      if (e.phase === "success") throw sinkBug;
    };
    await expect(
      runPipeline([logging({ onEvent })], ctx, async () => jsonResponse({})),
    ).rejects.toBe(sinkBug);
    expect(phases).toEqual(["start", "success"]);
  });
  it("is a no-op when disabled", async () => {
    const logger = spyLogger();
    await runPipeline([logging({ logger, enabled: false })], ctx, async () =>
      jsonResponse({}),
    );
    expect(logger.log).not.toHaveBeenCalled();
  });
  it("drops userinfo as well as the query string", async () => {
    const logger = spyLogger();
    await runPipeline(
      [logging({ logger })],
      { url: "https://user:secret@a/u?token=1", init: {} },
      async () => jsonResponse({}),
    );
    expect(logger.log.mock.calls[0]?.[0]).toBe("[arthron] → GET https://a/u");
  });
  it("onEvent receives structured start/success events and silences the default output", async () => {
    const logger = spyLogger();
    const events: unknown[] = [];
    await runPipeline(
      [logging({ logger, ...clock(), onEvent: (e) => events.push(e) })],
      ctx,
      async () => jsonResponse({}, { status: 201 }),
    );
    expect(events).toEqual([
      { phase: "start", method: "POST", path: "https://a/u" },
      {
        phase: "success",
        method: "POST",
        path: "https://a/u",
        status: 201,
        ms: 12,
      },
    ]);
    expect(logger.log).not.toHaveBeenCalled();
  });
  it("onEvent error events carry the status for ArthronError and undefined otherwise", async () => {
    const events: LogEvent[] = [];
    const plugin = () =>
      logging({ ...clock(), onEvent: (e) => events.push(e) });
    await runPipeline([plugin()], ctx, async (c) => {
      throw networkError(new Error("x"), c);
    }).catch(() => {});
    const bug = new RangeError("bug");
    await runPipeline([plugin()], ctx, async () => {
      throw bug;
    }).catch(() => {});
    expect(events.filter((e) => e.phase === "error")).toEqual([
      expect.objectContaining({ phase: "error", status: 0, ms: 12 }),
      expect.objectContaining({
        phase: "error",
        status: undefined,
        ms: 12,
        error: bug,
      }),
    ]);
  });
  it("onEvent is not called for cancellations", async () => {
    const events: unknown[] = [];
    const abort = new DOMException("a", "AbortError");
    await runPipeline(
      [logging({ onEvent: (e) => events.push(e) })],
      ctx,
      async () => {
        throw abort;
      },
    ).catch(() => {});
    expect(events.map((e) => (e as { phase: string }).phase)).toEqual([
      "start",
    ]);
  });
  it("defaults method to GET", async () => {
    const logger = spyLogger();
    await runPipeline(
      [logging({ logger })],
      { url: "https://a/u", init: {} },
      async () => jsonResponse({}),
    );
    expect(logger.log.mock.calls[0]?.[0]).toBe("[arthron] → GET https://a/u");
  });
});
