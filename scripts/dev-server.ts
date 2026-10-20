import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createRuntime } from "./runtime.js";
const port = Number(process.env.PORT || 4310);
const runtime = createRuntime({ demo: process.env.AGENT_ID_DEMO !== "false" });
const root = resolve("public");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (
      req.method === "GET" &&
      (url.pathname.startsWith("/sdk/") ||
        url.pathname.startsWith("/downloads/") ||
        url.pathname === "/")
    ) {
      const file = resolve(
        root,
        "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)),
      );
      if (!file.startsWith(root + sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const body = await readFile(file);
        const types: Record<string, string> = {
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".html": "text/html",
          ".tgz": "application/gzip",
        };
        res.writeHead(200, {
          "Content-Type": types[extname(file)] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(body);
        return;
      } catch {
        res.writeHead(404);
        res.end();
        return;
      }
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) {
        res.writeHead(413);
        res.end('{"error":"body_too_large"}');
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    const response = await runtime.handler(
      new Request(url, {
        method: req.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"internal_error"}');
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Collector on http://127.0.0.1:${port} (${process.env.AGENT_ID_DEMO === "false" ? "postgres" : "local memory fixture"})`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close();
    void runtime.close().finally(() => process.exit(0));
  });
