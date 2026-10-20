// Runs the built package against a real local HTTP server. Exercises only what
// a consumer gets from `dist/` — ESM and CJS — on each Node version CI runs.

import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const esm = await import("../dist/index.mjs");
const cjs = require("../dist/index.cjs");
const esmPlugins = await import("../dist/plugins.mjs");
const cjsPlugins = require("../dist/plugins.cjs");

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
};

assert(typeof esm.arthron === "function", "ESM entry exports arthron()");
assert(typeof cjs.arthron === "function", "CJS entry exports arthron()");
assert(
  Object.keys(esm).sort().join() === Object.keys(cjs).sort().join(),
  "ESM and CJS export the same names",
);
assert(
  typeof esmPlugins.retry === "function" &&
    Object.keys(esmPlugins).sort().join() ===
      Object.keys(cjsPlugins).sort().join(),
  "arthron/plugins loads, with the same names in ESM and CJS",
);
assert(
  !("retry" in esm) && !("timeout" in cjs),
  "the built-in plugins come from arthron/plugins only",
);

const crossCopy = await cjs
  .arthron({
    baseURL: "https://copies.test",
    fetch: async () => new Response("", { status: 500 }),
  })
  .get("/x")
  .catch((e) => e);
assert(
  esm.isArthronError(crossCopy) && crossCopy instanceof esm.ArthronError,
  "the ESM build recognises an ArthronError from the CJS build",
);

let hits = 0;
let endlessClosed = false;
const server = createServer((req, res) => {
  hits += 1;
  if (req.url === "/upload") {
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
    });
    req.on("end", () => res.end(JSON.stringify({ size })));
    return;
  }
  if (req.url === "/redirect") {
    res.writeHead(302, { location: "/echo" }).end();
    return;
  }
  if (req.url === "/endless") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const tick = setInterval(() => res.write("data: tick\n\n"), 5);
    res.on("close", () => {
      clearInterval(tick);
      endlessClosed = true;
    });
    return;
  }
  if (req.url === "/long-line") {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end("x".repeat(256 * 1024));
    return;
  }
  if (req.url === "/huge-error") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("x".repeat(1024 * 1024));
    return;
  }
  if (req.url?.startsWith("/fail")) {
    res.writeHead(500, { "content-type": "application/json" }).end("{}");
    return;
  }
  if (req.url === "/flaky" && hits === 1) {
    res.writeHead(503, { "retry-after": "0" }).end();
    return;
  }
  if (req.url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
    res.end("event: end\ndata: two\n\n");
    return;
  }
  if (req.url === "/progress-upload") {
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ n, cl: req.headers["content-length"] ?? null }));
    });
    return;
  }
  if (req.url === "/token") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ token: "new" }));
    return;
  }
  if (req.url === "/private") {
    const ok = req.headers.authorization === "Bearer new";
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ authorization: req.headers.authorization }));
    return;
  }
  if (req.url === "/slow") {
    setTimeout(() => res.end("{}"), 2_000);
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ method: req.method, url: req.url }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;

try {
  const { arthron, isArthronError } = esm;
  const { bearerAuth, retry, timeout } = esmPlugins;
  const api = arthron({
    baseURL,
    use: [retry({ delay: () => 0 }), timeout(500)],
  });

  const body = await api.get("/echo", { params: { q: 1 } }).json();
  assert(
    body.method === "GET" && body.url === "/echo?q=1",
    "GET with params reaches the server",
  );

  const res = await api.post("/echo", { a: 1 });
  assert(res instanceof Response && res.ok, "POST returns a native Response");

  const q = await api.query("/echo", { filter: 1 }).json();
  assert(
    q.method === "QUERY",
    "QUERY (RFC 10008) reaches the server as a method",
  );

  hits = 0;
  await api.get("/flaky");
  assert(hits === 2, "retry re-runs the request after a 503");

  const events = [];
  for await (const e of api.get("/events").sse()) events.push(e);
  assert(
    events.length === 2 &&
      events[1].event === "end" &&
      events[1].data === "two",
    ".sse() streams server-sent events",
  );

  const slow = await api.get("/slow").catch((e) => e);
  assert(
    slow?.name === "TimeoutError" && !isArthronError(slow),
    "timeout rejects with TimeoutError",
  );

  const upload = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("abc"));
      controller.close();
    },
  });
  const uploaded = await api.post("/upload", upload).json();
  assert(uploaded.size === 3, "a ReadableStream body uploads with real fetch");

  const manual = await arthron({ baseURL }).get("/redirect", {
    redirect: "manual",
  });
  assert(
    manual.status === 302 && manual.headers.get("location") === "/echo",
    'redirect: "manual" returns the 3xx instead of rejecting',
  );

  const redirected = await api.get("/redirect");
  assert(
    redirected.redirected && redirected.url === `${baseURL}/echo`,
    "timeout keeps res.url and res.redirected",
  );
  await redirected.text();

  for await (const _ of arthron({ baseURL }).get("/endless").sse()) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(endlessClosed, "leaving .sse() early closes the connection");

  const bad = await arthron({ baseURL: "api.example.com" })
    .get("/x")
    .catch((e) => e);
  assert(
    bad instanceof TypeError && !isArthronError(bad),
    "a baseURL without a scheme rejects with TypeError, not status 0",
  );

  const leaky = await arthron({
    baseURL,
    headers: { authorization: "Bearer SMOKE-TOKEN" },
  })
    .get("/fail", { params: { key: "SMOKE-QUERY" } })
    .catch((e) => e);
  const serialized = JSON.stringify(leaky);
  assert(
    isArthronError(leaky) &&
      !serialized.includes("SMOKE-TOKEN") &&
      !serialized.includes("SMOKE-QUERY") &&
      leaky.request.init.headers.authorization === "Bearer SMOKE-TOKEN",
    "ArthronError serializes without request secrets",
  );

  const huge = await arthron({ baseURL })
    .get("/huge-error")
    .catch((e) => e);
  assert(
    isArthronError(huge) &&
      huge.data.length === 64 * 1024 &&
      (await huge.response.text()).length === 64 * 1024,
    "a 1 MB error body is read only up to 64 KiB",
  );

  const tooLong = await (async () => {
    for await (const _ of arthron({ baseURL })
      .get("/long-line")
      .ndjson({ maxLineLength: 1024 })) {
    }
  })().catch((e) => e);
  assert(
    tooLong instanceof RangeError,
    "a stream line past maxLineLength rejects with RangeError",
  );

  let token = "old";
  let refreshes = 0;
  const authed = arthron({
    baseURL,
    use: [
      bearerAuth({
        origin: baseURL,
        token: () => token,
        refresh: async () => {
          refreshes += 1;
          const r = await authed
            .post("/token", undefined, { meta: { bearerAuth: false } })
            .json();
          token = r.token;
        },
      }),
    ],
  });
  const privates = await Promise.all(
    [1, 2, 3].map(() => authed.get("/private").json()),
  );
  assert(
    refreshes === 1 && privates.every((p) => p.authorization === "Bearer new"),
    "bearerAuth refreshes once for concurrent 401s and redoes each call",
  );

  const progress = [];
  const counted = await arthron({
    baseURL,
    use: [esmPlugins.uploadProgress()],
  })
    .put("/progress-upload", new Blob([new Uint8Array(1024 * 1024)]), {
      meta: { onUploadProgress: (e) => progress.push(e) },
    })
    .json();
  assert(
    counted.cl === "1048576" &&
      counted.n === 1048576 &&
      progress.length > 1 &&
      progress.at(-1).progress === 1,
    "uploadProgress counts a Node upload in steps and keeps content-length",
  );
} finally {
  server.closeAllConnections?.();
  server.close();
}
console.log(`smoke OK on node ${process.version}`);
