// Runs the built package against a real local HTTP server. Exercises only what
// a consumer gets from `dist/`, so it doubles as the Node 18 compatibility
// check in CI (the test suite itself needs a newer Node for vitest).

import { createServer, METHODS } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const esm = await import("../dist/index.mjs");
const cjs = require("../dist/index.cjs");

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
  const { arthron, retry, timeout, isArthronError } = esm;
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

  // fetch sends QUERY (RFC 10008) on every supported Node; the built-in http
  // server only parses it from Node 20 (llhttp). On 18 it answers 400, which
  // still proves the method string went over the wire.
  if (METHODS.includes("QUERY")) {
    const q = await api.query("/echo", { filter: 1 }).json();
    assert(q.method === "QUERY", "QUERY reaches the server as a method");
  } else {
    const rejected = await api.query("/echo", { filter: 1 }).catch((e) => e);
    assert(
      isArthronError(rejected) && rejected.status === 400,
      "QUERY is sent even where node:http cannot parse it",
    );
  }

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
} finally {
  server.closeAllConnections?.();
  server.close();
}
console.log(`smoke OK on node ${process.version}`);
