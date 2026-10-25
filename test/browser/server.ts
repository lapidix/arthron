// The server the browser tests call. It runs on its own port, so every call
// from the test page is cross-origin and goes through CORS the way a real API
// on another origin does: preflights, exposed headers, credentials.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    server: string;
  }
}

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

export default async function setup(project: TestProject) {
  const flaky = new Map<string, number>();

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin ?? "*";
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("access-control-expose-headers", "retry-after, x-request-id");
    res.setHeader("vary", "origin");

    if (req.method === "OPTIONS") {
      res.setHeader(
        "access-control-allow-methods",
        "GET, POST, PUT, PATCH, DELETE, QUERY",
      );
      res.setHeader(
        "access-control-allow-headers",
        req.headers["access-control-request-headers"] ?? "",
      );
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    switch (url.pathname) {
      case "/json":
        json(200, { ok: true });
        return;
      case "/echo": {
        // A browser that gives up on an upload resets the connection; there
        // is no one left to answer.
        const body = await readBody(req).catch(() => null);
        if (!body) return;
        json(200, {
          method: req.method,
          query: url.search,
          contentType: req.headers["content-type"] ?? null,
          trace: req.headers["x-trace"] ?? null,
          cookie: req.headers.cookie ?? null,
          body: body.toString("utf8"),
          size: body.length,
        });
        return;
      }
      case "/missing":
        json(404, { message: "no such user" });
        return;
      case "/blocked": {
        // A status past 599, as LinkedIn answers bots. An upload's body is
        // read first, or the browser may see a reset instead.
        await readBody(req).catch(() => null);
        res.writeHead(999, { "content-type": "text/plain" }).end("blocked");
        return;
      }
      case "/redirect":
        res.writeHead(302, { location: "/json" }).end();
        return;
      case "/flaky": {
        const id = url.searchParams.get("id") ?? "";
        const seen = (flaky.get(id) ?? 0) + 1;
        flaky.set(id, seen);
        if (seen === 1) {
          res.writeHead(503, { "retry-after": "0" }).end();
          return;
        }
        json(200, { attempts: seen });
        return;
      }
      case "/slow":
        setTimeout(() => json(200, { late: true }), 2_000).unref();
        return;
      case "/sse":
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("id: 1\ndata: one\n\n");
        res.write("event: note\ndata: two\ndata: lines\n\n");
        res.end("id: 3\ndata: three\n\n");
        return;
      case "/ndjson":
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end('{"n":1}\n{"n":2}\n{"n":3}\n');
        return;
      case "/cookie":
        res.setHeader("set-cookie", "sid=abc; Path=/; SameSite=Lax");
        json(200, { set: true });
        return;
      default:
        json(404, { message: `no route ${url.pathname}` });
    }
  });

  // localhost on another port: cross-origin but same-site, like an API on
  // api.example.com called from app.example.com.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  project.provide("server", `http://localhost:${port}`);

  return () =>
    new Promise<void>((resolve) => {
      // Browsers keep connections alive; close() alone would wait for them.
      server.closeAllConnections();
      server.close(() => resolve());
    });
}
