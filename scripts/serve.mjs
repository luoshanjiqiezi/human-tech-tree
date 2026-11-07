import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const basePort = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = resolve(join(root, normalize(pathname)));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>404</h1><p><a href=\"/\">返回科技树</a></p>");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error.message}`);
  }
});

function listen(port, attempts = 0) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 8) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1}…`);
      listen(port + 1, attempts + 1);
    } else {
      console.error(error);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`\n  人类科技树 → http://127.0.0.1:${port}\n  按 Ctrl+C 停止\n`);
  });
}

listen(basePort);
