import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { streamMiddleware } from "./stream.mjs";

const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

export const server = createServer((req, res) => {
  streamMiddleware(req, res, () => {
    void staticFile(req, res);
  });
});

async function staticFile(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      if (!extname(file)) file = resolve(root, "index.html");
      else throw new Error("Not found");
    }
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": file.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

server.listen(port, host, () => {
  console.log(`FlowScape listening on http://${host}:${port}`);
});
