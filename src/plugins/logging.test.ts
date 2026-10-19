import { describe, expect, it, vi } from "vitest";
import { networkError } from "../error";
import { runPipeline } from "../pipeline";
import { jsonResponse } from "../test-utils";
import { logging } from "./logging";

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
      ["[ferrule] → POST https://a/u"],
      ["[ferrule] ← POST https://a/u 201 12ms"],
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
      "[ferrule] ✕ POST https://a/u 0 12ms",
    );
  });
  it("logs non-FerruleError failures with '-' for status", async () => {
    const logger = spyLogger();
    await expect(
      runPipeline([logging({ logger, ...clock() })], ctx, async () => {
        throw new RangeError("bug");
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(logger.error).toHaveBeenCalledWith(
      "[ferrule] ✕ POST https://a/u - 12ms",
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
  it("is a no-op when disabled", async () => {
    const logger = spyLogger();
    await runPipeline([logging({ logger, enabled: false })], ctx, async () =>
      jsonResponse({}),
    );
    expect(logger.log).not.toHaveBeenCalled();
  });
  it("defaults method to GET", async () => {
    const logger = spyLogger();
    await runPipeline(
      [logging({ logger })],
      { url: "https://a/u", init: {} },
      async () => jsonResponse({}),
    );
    expect(logger.log.mock.calls[0]?.[0]).toBe("[ferrule] → GET https://a/u");
  });
});
