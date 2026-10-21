// The built package (dist/index.mjs, through the `arthron` link) in a real
// browser, calling a server on another origin. Covers what differs from Node:
// CORS preflights, opaque redirects, cookies, streaming bodies.
import { arthron, isArthronError } from "arthron";
import {
  retry,
  timeout,
  type UploadProgressEvent,
  uploadProgress,
} from "arthron/plugins";
import { describe, expect, inject, it } from "vitest";

type Echo = {
  method: string;
  query: string;
  contentType: string | null;
  trace: string | null;
  cookie: string | null;
  body: string;
  size: number;
};

const api = arthron({ baseURL: inject("server") });

describe("arthron in the browser", () => {
  it("gets JSON from another origin", async () => {
    expect(await api.get("/json").json()).toEqual({ ok: true });
  });

  it("sends a JSON body, params and a custom header through a preflight", async () => {
    const echo = await api
      .post(
        "/echo",
        { a: 1 },
        { queryParams: { q: "x" }, headers: { "x-trace": "t1" } },
      )
      .json<Echo>();
    expect(echo).toMatchObject({
      method: "POST",
      query: "?q=x",
      contentType: "application/json",
      trace: "t1",
      body: '{"a":1}',
    });
  });

  it("sends QUERY with its body", async () => {
    const echo = await api.query("/echo", { filter: "x" }).json<Echo>();
    expect(echo).toMatchObject({ method: "QUERY", body: '{"filter":"x"}' });
  });

  it("sends FormData as multipart with the browser's boundary", async () => {
    const form = new FormData();
    form.append("name", "x");
    const echo = await api.post("/echo", form).json<Echo>();
    expect(echo.contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  // No browser streams this one: Chromium and WebKit stream only over HTTP/2
  // (this server is HTTP/1.1), Firefox would send "[object ReadableStream]".
  // Each must fail with an error that says why, and nothing garbled sent.
  it("explains a ReadableStream body the browser cannot stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.close();
      },
    });
    const err = await api.post("/echo", body).catch((e: unknown) => e);
    if (/Firefox\//.test(navigator.userAgent)) {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toMatch(
        /cannot stream a request body .* pass a Blob or ArrayBuffer instead$/,
      );
    } else {
      expect(isArthronError(err)).toBe(true);
      expect((err as Error).message).toMatch(/streams only over HTTP\/2/);
    }
  });

  it("rejects a 404 with an ArthronError carrying the server's message", async () => {
    const err = await api.get("/missing").catch((e: unknown) => e);
    expect(isArthronError(err)).toBe(true);
    if (!isArthronError(err)) return;
    expect(err.status).toBe(404);
    expect(err.serverMessage).toBe("no such user");
  });

  it("follows a redirect by default", async () => {
    expect(await api.get("/redirect").json()).toEqual({ ok: true });
  });

  it("returns the opaque redirect of redirect: manual instead of rejecting", async () => {
    const res = await api.get("/redirect", { redirect: "manual" });
    expect(res.type).toBe("opaqueredirect");
    expect(res.status).toBe(0);
  });

  it("retries a 503 that sends retry-after", async () => {
    const res = await api
      .use(retry({ retries: 1 }))
      .get("/flaky", { queryParams: { id: crypto.randomUUID() } })
      .json<{ attempts: number }>();
    expect(res.attempts).toBe(2);
  });

  it("times out with a TimeoutError", async () => {
    const err = await api
      .use(timeout(100))
      .get("/slow")
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
  });

  it("rejects with the abort reason", async () => {
    const controller = new AbortController();
    const pending = api.get("/slow", { signal: controller.signal });
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
  });

  it("rejects with a custom abort reason", async () => {
    const reason = new Error("user left the page");
    const controller = new AbortController();
    const pending = api.get("/slow", { signal: controller.signal });
    controller.abort(reason);
    expect(await pending.catch((e: unknown) => e)).toBe(reason);
  });

  it("reads server-sent events", async () => {
    const events = [];
    for await (const e of api.get("/sse").sse()) {
      events.push({ event: e.event, data: e.data, id: e.id });
    }
    expect(events).toEqual([
      { event: undefined, data: "one", id: "1" },
      { event: "note", data: "two\nlines", id: undefined },
      { event: undefined, data: "three", id: "3" },
    ]);
  });

  it("reads NDJSON", async () => {
    const rows = [];
    for await (const row of api.get("/ndjson").ndjson<{ n: number }>()) {
      rows.push(row.n);
    }
    expect(rows).toEqual([1, 2, 3]);
  });

  it("sends cookies to another origin only with credentials: include", async () => {
    await api.get("/cookie", { credentials: "include" });
    const without = await api.get("/echo").json<Echo>();
    const included = await api
      .get("/echo", { credentials: "include" })
      .json<Echo>();
    expect(without.cookie).toBeNull();
    expect(included.cookie).toBe("sid=abc");
  });
});

describe("uploadProgress in the browser", () => {
  const uploads = arthron({
    baseURL: inject("server"),
    plugins: [uploadProgress()],
  });

  it("reports upload progress and keeps the Blob's type", async () => {
    const events: UploadProgressEvent[] = [];
    const file = new Blob([new Uint8Array(8 * 1024 * 1024)], {
      type: "application/octet-stream",
    });
    const echo = await uploads
      .post("/echo", file, {
        meta: { uploadProgress: (e) => events.push(e) },
      })
      .json<Echo>();
    expect(echo.size).toBe(8 * 1024 * 1024);
    expect(echo.contentType).toBe("application/octet-stream");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)?.progress).toBe(1);
  });

  it("leaves a call without the callback on fetch", async () => {
    const events = [];
    for await (const e of uploads.get("/sse").sse()) events.push(e);
    expect(events).toHaveLength(3);
  });

  it("retries a 503 and reports a 404 as ArthronError", async () => {
    const onProgress = () => {};
    const retried = await uploads
      .use(retry({ methods: ["POST"], delayFn: () => 0 }))
      .post("/flaky", "x", {
        queryParams: { id: `upload-${Math.random()}` },
        meta: { uploadProgress: onProgress },
      })
      .json();
    expect(retried).toEqual({ attempts: 2 });
    const err = await uploads
      .post("/missing", "x", { meta: { uploadProgress: onProgress } })
      .catch((e: unknown) => e);
    expect(isArthronError(err) && err.status).toBe(404);
    expect(isArthronError(err) && err.serverMessage).toBe("no such user");
  });

  it("times out with TimeoutError", async () => {
    const err = await uploads
      .use(timeout(100))
      .post("/slow", "x", { meta: { uploadProgress: () => {} } })
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
  });

  it("refuses redirect: manual with a TypeError before sending", async () => {
    const err = await uploads
      .post("/echo", "x", {
        redirect: "manual",
        meta: { uploadProgress: () => {} },
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(
      /meta\.uploadProgress cannot be combined/,
    );
  });

  it("reports a 0-byte body as complete", async () => {
    const events: UploadProgressEvent[] = [];
    await uploads.post("/echo", new Blob([]), {
      meta: { uploadProgress: (e) => events.push(e) },
    });
    expect(events.at(-1)).toEqual({ loaded: 0, total: 0, progress: 1 });
    expect(events.some((e) => Number.isNaN(e.progress))).toBe(false);
  });

  it("rejects an aborted upload with its reason and reports nothing after", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const events: UploadProgressEvent[] = [];
    let afterAbort = 0;
    const call = uploads
      .post("/echo", new Blob([new Uint8Array(8 * 1024 * 1024)]), {
        signal: controller.signal,
        meta: {
          uploadProgress: (e) => {
            events.push(e);
            if (controller.signal.aborted) afterAbort += 1;
          },
        },
      })
      .catch((e: unknown) => e);
    controller.abort(reason);
    expect(await call).toBe(reason);
    expect(afterAbort).toBe(0);
  });

  it("rejects with the callback's own error", async () => {
    const boom = new RangeError("boom");
    const err = await uploads
      .post("/echo", new Blob([new Uint8Array(1024 * 1024)]), {
        meta: {
          uploadProgress: () => {
            throw boom;
          },
        },
      })
      .catch((e: unknown) => e);
    expect(err).toBe(boom);
  });
});
