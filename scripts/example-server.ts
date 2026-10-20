import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Two independent website origins exercise storage and collector origin isolation.
const allowedPaths = new Map([
  ["/styles.css", ["examples/styles.css", "text/css"]],
  ["/plain/demo.js", ["examples/plain/demo.js", "text/javascript"]],
  ["/react/app.js", ["examples/react/app.js", "text/javascript"]],
  ["/plain/", ["examples/plain/index.html", "text/html"]],
  ["/react/", ["examples/react/index.html", "text/html"]],
]);
for (const port of [4311, 4312]) {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/") {
      res.writeHead(302, { Location: "/plain/" }).end();
      return;
    }
    const asset = allowedPaths.get(url.pathname);
    if (!asset || req.method !== "GET") {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      let body = await readFile(resolve(asset[0]!), "utf8");
      if (url.pathname === "/plain/" && url.searchParams.get("mode") === "optional") {
        body = body.replace('data-mode="required"', 'data-mode="optional"');
      }
      if (url.pathname === "/plain/" && url.searchParams.get("snippet") === "minimal") {
        body = body
          .replace('data-target="#visitor-choice"', "")
          .replace('data-api="http://127.0.0.1:4310"', "")
          .replace('<script defer src="/plain/demo.js"></script>', "");
      }
      res.writeHead(200, {
        "Content-Type": `${asset[1]}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": [
          "default-src 'none'",
          "script-src 'self' http://127.0.0.1:4310",
          "style-src 'self' http://127.0.0.1:4310",
          "connect-src http://127.0.0.1:4310",
          "img-src 'self'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join("; "),
      });
      res.end(body);
    } catch {
      res
        .writeHead(503, { "Content-Type": "text/plain" })
        .end("Run npm run build before starting the examples.");
    }
  }).listen(port, "127.0.0.1", () => {
    console.log(`Example website: http://127.0.0.1:${port}/plain/`);
  });
}
