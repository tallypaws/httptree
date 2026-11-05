/**
 * static file serving for httptree
 * handles etag, ranges, index files, and blocks path traversal
 *
 * `@tally.paws/httptree-ext-static`
 * 
 *
 * ```ts
 * import { root } from "@tally.paws/httptree";
 * import { staticFiles } from "@tally.paws/httptree-ext-static";
 *
 * const tree = root().extend(staticFiles({ dir: "./public", prefix: "/assets" }));
 * // or
 * tree.get("assets/[...path]", serveStatic("./public"));
 * ```
 *
 * @packageDocumentation
 */

import { createReadStream, type Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import {
  createResponse,
  defineExtension,
  error,
  stream,
  type Extension,
  type HttpTreeRequest,
  type TreeResponse
} from "@tally.paws/httptree";

/** options for {@link serveStatic} */
export interface StaticOptions {
  /**
   * file served for a directory, `false` makes directories a `404`
   * @default "index.html"
   */
  index?: string | false;
  /**
   * files and folders that start with a dot are a `404`, `"allow"` serves them
   * @default "ignore"
   */
  dotfiles?: "ignore" | "allow";
  /** the whole `Cache-Control` value, replaces `maxAge` and `immutable` */
  cacheControl?: string;
  /**
   * seconds browsers may reuse a file without refetching
   * @default 0
   */
  maxAge?: number;
  /** adds `immutable` to `Cache-Control` */
  immutable?: boolean;
  /**
   * send `ETag` and answer `If-None-Match` with a `304`
   * @default true
   */
  etag?: boolean;
  /**
   * send `Last-Modified` and answer `If-Modified-Since` with a `304`
   * @default true
   */
  lastModified?: boolean;
  /**
   * answer `Range` requests (video seeking, resumed downloads)
   * @default true
   */
  ranges?: boolean;
  /** file served (with a `200`) when the requested one doesnt exist, for single page apps (`"index.html"`) */
  fallback?: string;
  /**
   * serve symlinks that point outside the directory
   * @default false
   */
  followSymlinks?: boolean;
  /** extra or replaced mime types by extension, `{ ".wasm": "application/wasm" }` */
  mime?: Record<string, string>;
}

const mimes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".mts": "text/typescript; charset=utf-8",
  ".cts": "text/typescript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".koma": "application/koma; charset=utf-8", // :3
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".wasm": "application/wasm"
};

/** the mime type for a file name, `application/octet-stream` when unknown */
export function mimeType(file: string, extra?: Record<string, string>): string {
  const ext = path.extname(file).toLowerCase();
  return extra?.[ext] ?? mimes[ext] ?? "application/octet-stream";
}

const missingFile = new Set([
  "ENOENT",
  "ENOTDIR",
  "ENAMETOOLONG",
  "EACCES",
  "EPERM",
  "ELOOP"
]);

async function statFile(file: string): Promise<Stats | undefined> {
  try {
    return await stat(file);
  } catch (e: any) {
    if (missingFile.has(e?.code)) return undefined;
    throw e;
  }
}

function etagMatches(header: string, etag: string) {
  const strip = (s: string) => s.trim().replace(/^W\//, "");
  return header
    .split(",")
    .some((t) => t.trim() === "*" || strip(t) === strip(etag));
}

type ByteRange = { start: number; end: number };

/**
 * parses a `Range` header for a file of `size` bytes
 * `"none"` means ignore it and send the whole file, `"invalid"` is a `416`
 */
export function parseRange(
  header: string,
  size: number
): ByteRange | "none" | "invalid" {
  const m = /^bytes=(.*)$/i.exec(header.trim());
  if (!m) return "none";
  const specs = m[1]!.split(",");
  if (specs.length !== 1) return "none";
  const spec = /^\s*(\d*)\s*-\s*(\d*)\s*$/.exec(specs[0]!);
  if (!spec || (spec[1] === "" && spec[2] === "")) return "none";
  let start: number;
  let end: number;
  if (spec[1] === "") {
    const suffix = Number(spec[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(spec[1]);
    end = spec[2] === "" ? size - 1 : Math.min(Number(spec[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

/**
 * a route handler that serves files from a directory, put it on a rest param
 *
 * does `HEAD`, `ETag` and `Last-Modified` with `304`, `Range`, directory index files, and blocks anything that leaves the directory (`..`, encoded slashes, symlinks)
 * files are streamed, nothing is read into memory
 *
 * > [!NOTE]
 * > a missing file is a thrown `404`, so error handlers for `NotFound` apply
 *
 * @example
 * ```ts
 * tree.get("/assets/[...path]", serveStatic("./public", { maxAge: 3600 }));
 *
 * // behind a guard
 * const files = tree.branch("/private", isAuthed);
 * files.get("/[...path]", serveStatic("./private-files"));
 *
 * // single page app, everything unknown gets index.html
 * tree.get("/[...path]", serveStatic("./dist", { fallback: "index.html" }));
 * ```
 *
 * @param dir directory to serve, relative to the working directory
 */
export function serveStatic(dir: string, options: StaticOptions = {}) {
  const root = path.resolve(dir);
  const index = options.index === undefined ? "index.html" : options.index;
  const useEtag = options.etag !== false;
  const useLastModified = options.lastModified !== false;
  const useRanges = options.ranges !== false;
  let realRoot: Promise<string> | undefined;
  const cacheControl =
    options.cacheControl ??
    `public, max-age=${Math.max(0, Math.trunc(options.maxAge ?? 0))}${options.immutable ? ", immutable" : ""}`;

  async function inside(file: string): Promise<boolean> {
    if (options.followSymlinks) return true;
    try {
      realRoot ??= realpath(root);
      const [base, real] = await Promise.all([realRoot, realpath(file)]);
      return real === base || real.startsWith(base + path.sep);
    } catch {
      return false;
    }
  }

  /** turns segments into a file inside the directory, `undefined` for anything else */
  async function locate(segments: string[]) {
    for (const s of segments) {
      if (s === ".." || s.includes("\0") || s.includes("/") || s.includes("\\"))
        return undefined;
      if (options.dotfiles !== "allow" && s.startsWith(".")) return undefined;
    }
    let file = path.join(root, ...segments);
    if (file !== root && !file.startsWith(root + path.sep)) return undefined;
    let st = await statFile(file);
    if (st?.isDirectory()) {
      if (index === false) return undefined;
      file = path.join(file, index);
      st = await statFile(file);
    }
    if (!st?.isFile() || !(await inside(file))) return undefined;
    return { file, st };
  }

  return async function serve(
    req: HttpTreeRequest<{ path?: string[] }>
  ): Promise<TreeResponse> {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      throw error.methodNotAllowed(undefined, { Allow: "GET, HEAD" });
    }
    const segments = req.params.path ?? [];
    let found = await locate(segments);
    if (!found && options.fallback) {
      found = await locate(options.fallback.split("/").filter(Boolean));
    }
    if (!found) throw error.notFound();
    const { file, st } = found;
    const mtimeSec = Math.floor(st.mtimeMs / 1000) * 1000;

    const headers: Record<string, string> = {
      "Content-Type": mimeType(file, options.mime),
      "Cache-Control": cacheControl
    };
    if (useRanges) headers["Accept-Ranges"] = "bytes";
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (useEtag) headers["ETag"] = etag;
    if (useLastModified) headers["Last-Modified"] = st.mtime.toUTCString();

    const ifNoneMatch = req.headers["if-none-match"];
    const ifModifiedSince = req.headers["if-modified-since"];
    if (useEtag && ifNoneMatch) {
      if (etagMatches(ifNoneMatch, etag))
        return createResponse("", 304, headers);
    } else if (useLastModified && ifModifiedSince) {
      const since = Date.parse(ifModifiedSince);
      if (!Number.isNaN(since) && mtimeSec <= since)
        return createResponse("", 304, headers);
    }

    let status = 200;
    let range: ByteRange | undefined;
    const rangeHeader = req.headers.range;
    if (useRanges && rangeHeader) {
      const rawIfRange = req.headers["if-range"];
      const ifRange = Array.isArray(rawIfRange) ? rawIfRange[0] : rawIfRange;
      const unchanged =
        !ifRange ||
        (ifRange.startsWith('"') || ifRange.startsWith("W/")
          ? useEtag && ifRange === etag
          : Date.parse(ifRange) === mtimeSec);
      if (unchanged) {
        const parsed = parseRange(rangeHeader, st.size);
        if (parsed === "invalid") {
          return createResponse("", 416, {
            "Content-Range": `bytes */${st.size}`
          });
        }
        if (parsed !== "none") {
          range = parsed;
          status = 206;
        }
      }
    }
    const length = range ? range.end - range.start + 1 : st.size;
    headers["Content-Length"] = String(length);
    if (range)
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${st.size}`;
    if (method === "HEAD") return createResponse("", status, headers);
    return stream(createReadStream(file, range), { status, headers });
  };
}

/** options for {@link staticFiles} */
export interface StaticFilesOptions extends StaticOptions {
  /** the directory to serve */
  dir: string;
  /** url path the files are served under, `"/assets"` serves `./public/a.png` at `/assets/a.png` */
  prefix: string;
}

/**
 * {@link serveStatic} as an extension, it registers the `GET` route for you
 *
 * if you need a guard around the files or the route on a branch, use {@link serveStatic} directly
 *
 * @example
 * ```ts
 * const tree = root().extend(staticFiles({ dir: "./public", prefix: "/assets", maxAge: 3600 }));
 * ```
 */
export function staticFiles(options: StaticFilesOptions): Extension {
  const { dir, prefix, ...rest } = options;
  return defineExtension({
    name: `static:${prefix}`,
    setup(root) {
      const base = prefix.replace(/\/+$/, "");
      root.get(`${base}/[...path]` as "/[...path]", serveStatic(dir, rest));
    }
  });
}
