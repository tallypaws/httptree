import { createServer } from "http";
import { createReadStream, existsSync, readdirSync, statSync, watch } from "fs";
import path, { join, resolve, sep, extname } from "path";
import { createPages } from "./og/pages.ts";
import { renderOg } from "./og/render.ts";
import { galleryHtml } from "./og/gallery.ts";
import type { FSWatcher } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
const PORT = 3000;
const publicDir = join(import.meta.dirname, "generated");
const livePath = "/__live";
const ogPrefix = "/_og/";
const ogPages = createPages({
  generatedDir: publicDir,
  ogDir: join(import.meta.dirname, "og")
});
const ogGallery = process.env.NODE_ENV !== "production";

const mimes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".txt": "text/plain"
};

const settle = 150;
const poll = 2000;

const clients = new Set<any>();

function scan(dir = publicDir, base = "", out = new Map()) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const url = base + "/" + entry.name;
    if (entry.isDirectory()) {
      scan(join(dir, entry.name), url, out);
      continue;
    }
    try {
      const st = statSync(join(dir, entry.name));
      out.set(url, `${st.mtimeMs}:${st.size}`);
    } catch {}
  }
  return out;
}

let snapshot = scan();
let timer: string | number | NodeJS.Timeout | null | undefined = null;
let lastChange = 0;

function trigger() {
  clearTimeout(timer!);
  timer = setTimeout(announce, settle);
}

function announce() {
  const next = scan();
  const changed = [];
  for (const [path, sig] of next)
    if (snapshot.get(path) !== sig) changed.push(path);
  for (const path of snapshot.keys()) if (!next.has(path)) changed.push(path);
  snapshot = next;
  startWatcher();
  if (changed.length === 0) return;

  lastChange = Date.now();
  const message = `data: ${JSON.stringify({ paths: changed.slice(0, 200) })}\n\n`;
  for (const res of clients) res.write(message);
}

let watcher: FSWatcher | null = null;
let watchedIno: number | null = null;

function startWatcher() {
  watcher?.close();
  watcher = null;
  try {
    watchedIno = statSync(publicDir).ino;
    watcher = watch(publicDir, { recursive: true }, trigger);
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
      trigger();
      setTimeout(startWatcher, 200);
    });
  } catch {
    watchedIno = null;
    setTimeout(startWatcher, 500);
  }
}
startWatcher();

setInterval(() => {
  let ino = null;
  try {
    ino = statSync(publicDir).ino;
  } catch {}
  if (ino !== null && ino !== watchedIno) startWatcher();
  trigger();
}, poll).unref();

function handleLive(req: IncomingMessage, res: any) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 1000\n\n");
  clients.add(res);

  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

function send(
  res: ServerResponse<IncomingMessage> & { req: IncomingMessage },
  status: number,
  text: string
) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

async function handleOg(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage> & { req: IncomingMessage },
  url: URL,
  pathname: string
) {
  if (pathname === "/_og" || pathname === ogPrefix) {
    if (!ogGallery) return send(res, 404, "404 Not Found");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache"
    });
    return res.end(
      galleryHtml(ogPages.list(), url.searchParams.get("q") ?? "")
    );
  }
  if (pathname === "/_og/__stamp" && ogGallery) {
    return send(
      res,
      200,
      `${ogPages.templateMtime()}:${snapshot.size}:${lastChange}`
    );
  }
  if (!pathname.endsWith(".png")) return send(res, 404, "404 Not Found");

  const page = ogPages.get("/" + pathname.slice(ogPrefix.length, -4));
  if (!page) return send(res, 404, "404 Not Found");
  try {
    const { png } = await renderOg(page);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": png.length,
      "Cache-Control": url.searchParams.has("v")
        ? "public, max-age=31536000, immutable"
        : "no-cache"
    });
    res.end(png);
  } catch (err) {
    console.error(`og render failed for ${pathname}:`, err);
    send(res, 500, "500 Internal Server Error");
  }
}

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url!, "http://localhost").pathname
    );
  } catch {
    return send(res, 400, "400 Bad Request");
  }

  if (pathname === livePath) return handleLive(req, res);
  if (pathname === "/_og" || pathname.startsWith(ogPrefix)) {
    return void handleOg(
      req,
      res,
      new URL(req.url!, "http://localhost"),
      pathname
    );
  }

  let filePath = resolve(publicDir, "." + pathname);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
    return send(res, 403, "403 Forbidden");
  }

  if (pathname.endsWith(".html")) {
    try {
      if (statSync(filePath).isFile()) {
        const to = pathname === "/index.html" ? "/" : pathname.slice(0, -5);
        res.writeHead(301, { Location: to });
        return res.end();
      }
    } catch {}
  }

  try {
    try {
      if (statSync(filePath).isDirectory())
        filePath = join(filePath, "index.html");
      if (!statSync(filePath).isFile()) throw new Error("not a file");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        const htmlPath = `${filePath}.html`;
        if (existsSync(htmlPath)) {
          filePath = htmlPath;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.log(err);
    return send(res, 404, "404 Not Found");
  }

  const contentType =
    (mimes as any)[extname(filePath).toLowerCase() as any] ||
    "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache"
  });
  const stream = createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => {
    if (!res.headersSent) send(res, 500, "500 Internal Server Error");
    else res.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`running at http://localhost:${PORT}/`);
  const home = ogPages.get("/");
  if (home)
    renderOg(home).catch((err) => console.error("og failed:", err));
});
