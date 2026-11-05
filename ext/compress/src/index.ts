/**
 * brotli, gzip and deflate for httptree responses
 *
 * `@tally.paws/httptree-ext-compress`
 * 
 * ```ts
 * import { root } from "@tally.paws/httptree";
 * import { compress } from "@tally.paws/httptree-ext-compress";
 *
 * const tree = root().extend(compress());
 * ```
 * @packageDocumentation
 */

import { promisify } from "node:util";
import {
  brotliCompress,
  constants,
  createBrotliCompress,
  createDeflate,
  createGzip,
  deflate,
  gzip
} from "node:zlib";
import { pipeline } from "node:stream";
import {
  addVary,
  defineExtension,
  deleteHeader,
  getHeader,
  hasHeader,
  setHeader,
  type Extension,
  type HttpTreeRequest,
  type ResponseHeaders
} from "@tally.paws/httptree";

/** an encoding {@link compress} can use */
export type Encoding = "br" | "gzip" | "deflate";

/** options for {@link compress} */
export interface CompressOptions {
  /**
   * bodies smaller than this are sent as is
   * streams ignore this
   *
   * @default 1024
   */
  threshold?: number;
  /**
   * encodings to offer, the order is the preference when the client likes them the same
   * @default ["br", "gzip", "deflate"]
   */
  encodings?: Encoding[];
  /**
   * brotli quality 0 to 11
   * @default 4
   */
  brotliQuality?: number;
  /**
   * gzip and deflate level 1 to 9
   * @default 6
   */
  level?: number;
  /** decides from the `Content-Type` if a response gets compressed, the default takes text, json, xml, javascript, svg, wasm and fonts */
  filter?: (contentType: string | undefined, req: HttpTreeRequest) => boolean;
  /**
   * middleware priority, has to be below everything that changes the body
   * @default -1000
   */
  priority?: number;
}

const gzipAsync = promisify(gzip);
const deflateAsync = promisify(deflate);
const brotliAsync = promisify(brotliCompress);

const COMPRESSIBLE =
  /^(?:text\/(?!event-stream)|application\/(?:json|javascript|ecmascript|xml|x-www-form-urlencoded|wasm|manifest\+json|ld\+json)|image\/svg\+xml|font\/(?:ttf|otf)|application\/vnd\.ms-fontobject)|\+(?:json|xml)$/;

/** the default for {@link CompressOptions.filter} */
export function isCompressible(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return COMPRESSIBLE.test(type);
}

/**
 * picks the encoding from an `Accept-Encoding` header
 *
 * @returns `undefined` if nothing fits, send the body as is
 */
export function pickEncoding(
  header: string | undefined,
  supported: readonly Encoding[] = ["br", "gzip", "deflate"]
): Encoding | undefined {
  if (!header) return undefined;
  const q = new Map<string, number>();
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    let value = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) value = Number(m[1]);
    }
    q.set(name.trim().toLowerCase(), Number.isNaN(value) ? 0 : value);
  }
  let best: Encoding | undefined;
  let bestQ = 0;
  for (const enc of supported) {
    const value = q.get(enc) ?? q.get("*") ?? 0;
    if (value > bestQ) {
      best = enc;
      bestQ = value;
    }
  }
  return best;
}

function weakenEtag(headers: ResponseHeaders) {
  const etag = getHeader(headers, "etag");
  if (typeof etag === "string" && !etag.startsWith("W/")) {
    setHeader(headers, "ETag", `W/${etag}`);
  }
}

/**
 * compresses responses with brotli, gzip or deflate, whatever the client likes most
 *
 * works on the response before its sent so it covers handlers, errors, `404` and streams (static files too)
 * skips responses that are already encoded, `Cache-Control: no-transform`, `204`, `206`, `304`, types that dont compress (images, zip, video) and server sent events
 *
 * > [!NOTE]
 * > writing straight to the raw `res` skips the response system, so it skips this too
 *
 * @example
 * ```ts
 * const tree = root().extend(compress({ threshold: 512 }));
 * ```
 */
export function compress(options: CompressOptions = {}): Extension {
  const threshold = options.threshold ?? 1024;
  const encodings = options.encodings ?? ["br", "gzip", "deflate"];
  const level = options.level ?? 6;
  const quality = options.brotliQuality ?? 4;
  const brOpts = { params: { [constants.BROTLI_PARAM_QUALITY]: quality } };

  function encoder(enc: Encoding) {
    switch (enc) {
      case "br":
        return createBrotliCompress({
          ...brOpts,
          flush: constants.BROTLI_OPERATION_FLUSH
        });
      case "gzip":
        return createGzip({ level, flush: constants.Z_SYNC_FLUSH });
      case "deflate":
        return createDeflate({ level, flush: constants.Z_SYNC_FLUSH });
    }
  }
  function compressBuffer(enc: Encoding, buf: Buffer): Promise<Buffer> {
    switch (enc) {
      case "br":
        return brotliAsync(buf, brOpts);
      case "gzip":
        return gzipAsync(buf, { level });
      case "deflate":
        return deflateAsync(buf, { level });
    }
  }

  return defineExtension({
    name: "compress",
    setup(root) {
      root.use(async (req) => {
        const response = req.response;
        if (!response) return;
        const { headers } = response;
        if ([204, 206, 304].includes(response.status)) return;
        if (hasHeader(headers, "content-encoding")) return;
        if (hasHeader(headers, "content-range")) return;
        const cacheControl = getHeader(headers, "cache-control");
        if (
          cacheControl &&
          /(?:^|,)\s*no-transform\b/i.test(String(cacheControl))
        )
          return;
        const contentType = getHeader(headers, "content-type");
        const type = Array.isArray(contentType) ? contentType[0] : contentType;
        const ok = options.filter
          ? options.filter(type, req as HttpTreeRequest)
          : isCompressible(type);
        if (!ok) return;
        addVary(headers, "Accept-Encoding");
        const enc = pickEncoding(req.headers["accept-encoding"], encodings);
        if (!enc) return;
        const body = response.body;
        if (typeof body === "string" || Buffer.isBuffer(body)) {
          const buf = typeof body === "string" ? Buffer.from(body) : body;
          if (buf.length < threshold) return;
          response.body = await compressBuffer(enc, buf);
        } else if (req.method !== "HEAD") {
          response.body = pipeline(body as any, encoder(enc), () => {}) as any;
        }
        deleteHeader(headers, "content-length");
        setHeader(headers, "Content-Encoding", enc);
        weakenEtag(headers);
      }, options.priority ?? -1000);
    }
  });
}
