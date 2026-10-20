import { describe, expect, it } from "vitest";
import type { UploadProgressEvent } from "../../types/request.types";
import { countingFetch } from "./counting-fetch";

type Got = { body: Uint8Array; headers: Record<string, string> };

/** A fetch that reads the whole body, as a real one would, and records it. Fails like undici: a body error becomes "fetch failed". */
const reading = () => {
  const got: Got[] = [];
  const impl = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    try {
      const body = new Uint8Array(await new Response(init.body).arrayBuffer());
      got.push({
        body,
        headers: { ...(init.headers as Record<string, string>) },
      });
      return new Response("ok");
    } catch (cause) {
      throw new TypeError("fetch failed", { cause });
    }
  };
  return Object.assign(impl as typeof fetch, { got });
};

const send = async (body: unknown, headers: Record<string, string> = {}) => {
  const base = reading();
  const events: UploadProgressEvent[] = [];
  await countingFetch(base, (e) => events.push(e))("https://a/u", {
    method: "PUT",
    body: body as BodyInit,
    headers,
  });
  return { got: base.got[0] as Got, events };
};

describe("countingFetch", () => {
  it("counts a Blob as it is read and keeps its type", async () => {
    const blob = new Blob([new Uint8Array(200_000).fill(7)], {
      type: "application/octet-stream",
    });
    const { got, events } = await send(blob);
    expect(events.at(-1)).toEqual({
      loaded: 200_000,
      total: 200_000,
      progress: 1,
    });
    const loaded = events.map((e) => e.loaded);
    expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
    expect(new Set(loaded).size).toBe(loaded.length);
    expect(got.body.length).toBe(200_000);
    expect(got.headers["content-length"]).toBe("200000");
    expect(got.headers["content-type"]).toBe("application/octet-stream");
  });

  it("reports a large Blob in 64 KiB steps, however it is chunked", async () => {
    // Node hands an in-memory Blob over as a single chunk.
    const { events } = await send(new Blob([new Uint8Array(200_000)]));
    expect(events.map((e) => e.loaded)).toEqual([
      65_536, 131_072, 196_608, 200_000,
    ]);
  });

  it("keeps a content-type the caller set", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    const { got } = await send(blob, {
      "content-type": "application/octet-stream",
    });
    expect(got.headers["content-type"]).toBe("application/octet-stream");
  });

  it("measures a string in UTF-8 bytes", async () => {
    const { got, events } = await send("한글");
    expect(got.headers["content-length"]).toBe("6");
    expect(got.headers["content-type"]).toBe("text/plain;charset=UTF-8");
    expect(events.at(-1)).toEqual({ loaded: 6, total: 6, progress: 1 });
    expect(new TextDecoder().decode(got.body)).toBe("한글");
  });

  it("sends URLSearchParams as a form", async () => {
    const { got } = await send(new URLSearchParams({ a: "1", b: "2" }));
    expect(new TextDecoder().decode(got.body)).toBe("a=1&b=2");
    expect(got.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
  });

  it("sends a FormData body with its multipart boundary", async () => {
    const form = new FormData();
    form.append("name", "kim");
    const { got } = await send(form);
    expect(got.headers["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(got.headers["content-length"]).toBe(String(got.body.length));
    expect(new TextDecoder().decode(got.body)).toContain("kim");
  });

  it("reports a 0-byte body once, as complete", async () => {
    const { events } = await send(new Blob([]));
    expect(events).toEqual([{ loaded: 0, total: 0, progress: 1 }]);
  });

  it("leaves total unknown for a stream without content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
        c.enqueue(new Uint8Array(10));
        c.close();
      },
    });
    const { got, events } = await send(stream);
    expect(events.at(-1)).toEqual({
      loaded: 20,
      total: undefined,
      progress: undefined,
    });
    expect(got.headers["content-length"]).toBeUndefined();
  });

  it("does not touch the caller's init", async () => {
    const blob = new Blob(["abc"]);
    const init: RequestInit = { method: "PUT", body: blob, headers: {} };
    await countingFetch(reading(), () => {})("https://a/u", init);
    expect(init.body).toBe(blob);
    expect(init).not.toHaveProperty("duplex");
    expect(init.headers).toEqual({});
  });

  it("passes a call without a body through untouched", async () => {
    const base = reading();
    const events: UploadProgressEvent[] = [];
    await countingFetch(base, (e) => events.push(e))("https://a/u", {});
    expect(events).toEqual([]);
    expect(base.got[0]?.body.length).toBe(0);
  });

  it("rejects with the callback's own error", async () => {
    const boom = new RangeError("boom");
    const call = countingFetch(reading(), () => {
      throw boom;
    })("https://a/u", { method: "PUT", body: new Blob(["abc"]), headers: {} });
    await expect(call).rejects.toBe(boom);
  });

  it("stops counting when the call is aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    // Reads one chunk at a time, slowly, and honours the signal like fetch.
    const slow = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        if (init.signal?.aborted) {
          await reader.cancel(init.signal.reason).catch(() => {});
          throw init.signal.reason;
        }
        const { done } = await reader.read();
        if (done) return new Response("ok");
        await new Promise((r) => setTimeout(r, 5));
      }
    }) as typeof fetch;
    const events: UploadProgressEvent[] = [];
    const call = countingFetch(slow, (e) => {
      events.push(e);
      if (events.length === 1) controller.abort(reason);
    })("https://a/u", {
      method: "PUT",
      body: new Uint8Array(1024 * 1024),
      headers: {},
      signal: controller.signal,
    });
    await expect(call).rejects.toBe(reason);
    expect(events).toHaveLength(1);
  });
});
