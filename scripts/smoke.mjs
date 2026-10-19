// Runs the built package against a real local HTTP server. Exercises only what
// a consumer gets from `dist/`, so it doubles as the Node 18 compatibility
// check in CI (the test suite itself needs a newer Node for vitest).

import { createServer } from "node:http";
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
const server = createServer((req, res) => {
  hits += 1;
  if (req.url === "/flaky" && hits === 1) {
    res.writeHead(503, { "retry-after": "0" }).end();
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

  hits = 0;
  await api.get("/flaky");
  assert(hits === 2, "retry re-runs the request after a 503");

  const slow = await api.get("/slow").catch((e) => e);
  assert(
    slow?.name === "TimeoutError" && !isArthronError(slow),
    "timeout rejects with TimeoutError",
  );
} finally {
  server.close();
}
console.log(`smoke OK on node ${process.version}`);
