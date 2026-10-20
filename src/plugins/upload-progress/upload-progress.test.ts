import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { arthron } from "../../client/client";
import { runPipeline } from "../../pipeline/pipeline";
import { fakeFetch, jsonResponse } from "../../testkit/fetch.testkit";
import type {
  RequestContext,
  UploadProgressEvent,
} from "../../types/request.types";
import { bearerAuth } from "../bearer-auth/bearer-auth";
import { retry } from "../retry/retry";
import { uploadProgress } from "./upload-progress";

/** What the plugin hands to send, for a context built here. */
const sent = async (ctx: Partial<RequestContext>) => {
  let out: RequestContext | undefined;
  await runPipeline(
    [uploadProgress()],
    { url: "https://a/u", init: { headers: {} }, meta: {}, ...ctx },
    async (c) => {
      out = c;
      return jsonResponse({});
    },
  );
  return out as RequestContext;
};

describe("uploadProgress", () => {
  it("is named uploadProgress", () => {
    expect(uploadProgress().name).toBe("uploadProgress");
  });

  it("leaves a call without the callback untouched", async () => {
    const out = await sent({
      fetch: globalThis.fetch,
      init: { method: "PUT", body: "x", headers: {} },
    });
    expect(out.fetch).toBe(globalThis.fetch);
    expect(out.init.body).toBe("x");
  });

  it("leaves a call without a body untouched", async () => {
    const events: UploadProgressEvent[] = [];
    const out = await sent({
      fetch: globalThis.fetch,
      meta: { onUploadProgress: (e) => events.push(e) },
    });
    expect(out.fetch).toBe(globalThis.fetch);
    expect(events).toEqual([]);
  });

  it("steps aside for an injected fetch", async () => {
    const injected = fakeFetch(jsonResponse({}));
    const out = await sent({
      fetch: injected,
      init: { method: "PUT", body: "x", headers: {} },
      meta: { onUploadProgress: () => {} },
    });
    expect(out.fetch).toBe(injected);
  });

  it("wraps the runtime fetch in Node and keeps the original body", async () => {
    const blob = new Blob(["abc"]);
    const out = await sent({
      fetch: globalThis.fetch,
      init: { method: "PUT", body: blob, headers: {} },
      meta: { onUploadProgress: () => {} },
    });
    expect(out.fetch).not.toBe(globalThis.fetch);
    expect(typeof out.fetch).toBe("function");
    expect(out.init.body).toBe(blob);
  });
});

describe("uploadProgress keeps argument errors", () => {
  it("rejects a malformed URL with a TypeError, not a retried network error", async () => {
    let attempts = 0;
    const api = arthron({
      use: [
        retry({
          methods: ["PUT"],
          delay: () => 0,
          onRetry: () => {
            attempts += 1;
          },
        }),
        uploadProgress(),
      ],
    });
    const err = await api
      .put("http://exa mple.test/x", "hello", {
        meta: { onUploadProgress: () => {} },
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(/arthron: cannot send PUT/);
    expect(attempts).toBe(0);
  });
});

describe("uploadProgress against a real server", () => {
  let base = "";
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    let n = 0;
    req.on("data", (chunk: Buffer) => {
      n += chunk.length;
    });
    req.on("end", () => {
      if (hits === 1) return res.writeHead(503).end();
      if (req.headers.authorization !== "Bearer new") {
        return res.writeHead(401).end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ n, cl: req.headers["content-length"] ?? null }));
    });
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(() => {
    hits = 0;
  });

  it("rejects with the callback's own error, untouched and not retried", async () => {
    hits = 1; // past the server's one-off 503
    const boom = new RangeError("boom");
    const seen: unknown[] = [];
    const api = arthron({
      baseURL: base,
      headers: { authorization: "Bearer new" },
      use: [
        retry({ methods: ["PUT"], delay: () => 0 }),
        {
          error: (e) => {
            seen.push(e);
            return e;
          },
        },
        uploadProgress(),
      ],
    });
    const before = hits;
    const err = await api
      .put("/u", new Blob([new Uint8Array(300_000)]), {
        meta: {
          onUploadProgress: () => {
            throw boom;
          },
        },
      })
      .catch((e: unknown) => e);
    expect(err).toBe(boom);
    expect(seen).toEqual([]);
    expect(hits - before).toBeLessThanOrEqual(1);
  });

  it("uploads with progress through retry and bearerAuth, keeping content-length", async () => {
    let token = "old";
    const api = arthron({
      baseURL: base,
      use: [
        bearerAuth({
          origin: base,
          token: () => token,
          refresh: async () => {
            token = "new";
          },
        }),
        retry({ methods: ["PUT"], delay: () => 0 }),
        uploadProgress(),
      ],
    });
    const events: UploadProgressEvent[] = [];
    const out = await api
      .put("/u", new Blob([new Uint8Array(300_000)]), {
        meta: { onUploadProgress: (e) => events.push(e) },
      })
      .json();
    expect(out).toEqual({ n: 300_000, cl: "300000" });
    expect(hits).toBe(3);
    // Each attempt counts from the start again.
    const restarts = events.filter(
      (e, i) => i > 0 && e.loaded < (events[i - 1]?.loaded ?? 0),
    ).length;
    expect(restarts).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toEqual({
      loaded: 300_000,
      total: 300_000,
      progress: 1,
    });
  });
});
