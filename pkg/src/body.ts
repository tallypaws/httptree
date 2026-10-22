import * as http from "http";
import { Readable } from "stream";
import { error, isTreeResponse } from "./response.js";
import { _require, debug, parseSize } from "./util.js";

/** bytes (`1024`) or string (`"512kb"`, `"1.5mb"`, `"2gb"`)*/
export type Size = number | string;

export interface BodyConfig {
  /** max size for JSON or text bodies
   * default 1mb */
  maxSize?: Size;
  /** Max size for files
   * @default 10mb */
  maxFileSize?: Size;
  /** max number of files
   * @default 10 */
  maxFiles?: number;
  /** max number fields form
   * @default 100 */
  maxFields?: number;
  /** max size of a single multipart field
   * @default 100kb*/
  maxFieldSize?: Size;
}

export const DefaultBodyConfig = {
  maxSize: "1mb",
  maxFileSize: "10mb",
  maxFiles: 10,
  maxFields: 100,
  maxFieldSize: "100kb"
} as const satisfies Required<BodyConfig>;

export interface BufferOptions {
  maxSize?: Size;
}

export interface TextOptions extends BufferOptions {
  encoding?: string;
}

export interface JSONOptions<T = unknown> extends BufferOptions {
  requireContentType?: boolean;
  allowEmpty?: boolean;
  validate?: (value: unknown) => T | Promise<T>;
}

export type FormOptions = BodyConfig;

export interface UploadedFile {
  field: string;
  /** @ */
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

export interface ParsedForm {
  fields: Record<string, string | string[]>;
  files: UploadedFile[];
}

export interface BodyState {
  body?: Promise<Buffer>;
  form?: Promise<ParsedForm>;
}

const num = (v: Size | undefined, fallback: Size, name: string) =>
  parseSize(v ?? fallback, name);

function tooLarge(what: string, max: number) {
  return error.payloadTooLarge(`${what} (limit: ${max} bytes)`, {
    Connection: "close"
  });
}

function parseContentType(header: string | undefined) {
  const [type = "", ...rest] = (header ?? "").split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf("=");
    if (i === -1) continue;
    params[p.slice(0, i).trim().toLowerCase()] = p
      .slice(i + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return { type: type.trim().toLowerCase(), params };
}

function checkEncoding(req: http.IncomingMessage) {
  const enc = String(req.headers["content-encoding"] ?? "").toLowerCase();
  if (enc && enc !== "identity") {
    throw error.unsupportedMediaType(`Unsupported Content-Encoding: ${enc}`);
  }
}

function collect(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) {
      return reject(tooLarge("Payload too large", max));
    }

    if (req.readableEnded) {
      return reject(
        new Error("httptree: the request body was already consumed")
      );
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      fn();
    };

    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        finish(() => reject(tooLarge("Payload too large", max)));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks, size)));
    const onError = () =>
      finish(() => reject(error.badRequest("Request aborted")));
    const onClose = () => {
      if (!req.readableEnded) onError();
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
  });
}

export async function readBuffer(
  req: http.IncomingMessage,
  st: BodyState,
  cfg: BodyConfig,
  opts?: BufferOptions
): Promise<Buffer> {
  checkEncoding(req);
  const max = num(
    opts?.maxSize ?? cfg.maxSize,
    DefaultBodyConfig.maxSize,
    "maxSize"
  );

  st.body ??= collect(req, max);
  const buf = await st.body;
  if (buf.length > max) throw tooLarge("Payload too large", max);
  return buf;
}

function decode(buf: Buffer, label = "utf-8") {
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    throw error.unsupportedMediaType(`Unsupported charset: ${label}`);
  }
}

export async function readText(
  req: http.IncomingMessage,
  st: BodyState,
  cfg: BodyConfig,
  opts?: TextOptions
): Promise<string> {
  const buf = await readBuffer(req, st, cfg, opts);
  const charset = parseContentType(req.headers["content-type"]).params.charset;
  return decode(buf, opts?.encoding ?? charset);
}

export async function readJSON<T>(
  req: http.IncomingMessage,
  st: BodyState,
  cfg: BodyConfig,
  opts?: JSONOptions<T>
): Promise<T | undefined> {
  const hasBody =
    req.headers["transfer-encoding"] !== undefined ||
    Number(req.headers["content-length"] ?? 0) > 0;

  if (hasBody && opts?.requireContentType !== false) {
    const { type } = parseContentType(req.headers["content-type"]);
    if (type !== "application/json" && !type.endsWith("+json")) {
      throw error.unsupportedMediaType(
        "Expected Content-Type: application/json"
      );
    }
  }

  const body = await readText(req, st, cfg, opts);

  if (body.trim() === "") {
    if (opts?.allowEmpty) return undefined;
    throw error.badRequest("Request body is empty");
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw error.badRequest("Invalid JSON");
  }

  if (!opts?.validate) return value as T;

  try {
    return await opts.validate(value);
  } catch (e) {
    if (isTreeResponse(e)) throw e;
    throw error.unprocessableEntity(e instanceof Error ? e.message : String(e));
  }
}

export function readForm(
  req: http.IncomingMessage,
  st: BodyState,
  cfg: BodyConfig,
  opts?: FormOptions
): Promise<ParsedForm> {
  return (st.form ??= parseForm(req, st, cfg, opts));
}

function addField(
  fields: Record<string, string | string[]>,
  name: string,
  value: string
) {
  const prev = fields[name];
  if (prev === undefined) fields[name] = value;
  else if (Array.isArray(prev)) prev.push(value);
  else fields[name] = [prev, value];
}

async function parseForm(
  req: http.IncomingMessage,
  st: BodyState,
  cfg: BodyConfig,
  opts?: FormOptions
): Promise<ParsedForm> {
  const { type } = parseContentType(req.headers["content-type"]);

  if (type === "application/x-www-form-urlencoded") {
    const maxFields =
      opts?.maxFields ?? cfg.maxFields ?? DefaultBodyConfig.maxFields;
    const body = await readText(req, st, cfg, opts);
    const fields: Record<string, string | string[]> = Object.create(null);
    let count = 0;

    for (const [k, v] of new URLSearchParams(body)) {
      if (++count > maxFields) throw tooLarge("Too many fields", maxFields);
      addField(fields, k, v);
    }
    return { fields, files: [] };
  }

  if (type === "multipart/form-data") {
    return parseMultipart(req, st, cfg, opts);
  }

  throw error.unsupportedMediaType(
    "Expected Content-Type: multipart/form-data or application/x-www-form-urlencoded"
  );
}

type BusboyFactory = (config: any) => any;
let busboy: BusboyFactory | undefined;

function loadBusboy(): BusboyFactory {
  if (busboy) return busboy;
  try {
    const mod = _require("busboy");
    busboy = mod.default ?? mod;
    return busboy!;
  } catch {
    throw new Error(
      "httptree: multipart parsing requires 'busboy' package: npm i busboy"
    );
  }
}

async function parseMultipart(
  req: http.IncomingMessage,
  st: BodyState,
  cfg: BodyConfig,
  opts?: FormOptions
): Promise<ParsedForm> {
  const Busboy = loadBusboy();
  checkEncoding(req);

  const maxFileSize = num(
    opts?.maxFileSize ?? cfg.maxFileSize,
    DefaultBodyConfig.maxFileSize,
    "maxFileSize"
  );
  const maxFieldSize = num(
    opts?.maxFieldSize ?? cfg.maxFieldSize,
    DefaultBodyConfig.maxFieldSize,
    "maxFieldSize"
  );
  const maxFiles =
    opts?.maxFiles ?? cfg.maxFiles ?? DefaultBodyConfig.maxFiles;
  const maxFields =
    opts?.maxFields ?? cfg.maxFields ?? DefaultBodyConfig.maxFields;

  const explicit = opts?.maxSize ?? cfg.maxSize;
  const maxTotal =
    explicit !== undefined
      ? parseSize(explicit, "maxSize")
      : maxFileSize * maxFiles + maxFieldSize * maxFields + 1024 ** 2;

  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxTotal) {
    throw tooLarge("Payload too large", maxTotal);
  }

  const source: Readable = st.body ? Readable.from([await st.body]) : req;
  const live = source === req;

  return new Promise<ParsedForm>((resolve, reject) => {
    let bb: any;
    try {
      bb = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: {
          fileSize: maxFileSize,
          files: maxFiles,
          fields: maxFields,
          fieldSize: maxFieldSize,
          parts: maxFiles + maxFields
        }
      });
    } catch (e) {
      return reject(
        error.badRequest(e instanceof Error ? e.message : "Bad multipart body")
      );
    }

    const fields: Record<string, string | string[]> = Object.create(null);
    const files: UploadedFile[] = [];
    let total = 0;
    let failed = false;

    const onData = (c: Buffer) => {
      total += c.length;
      if (total > maxTotal) fail(tooLarge("Payload too large", maxTotal));
    };
    const onClose = () => {
      if (!req.readableEnded) fail(error.badRequest("Request aborted"));
    };

    const cleanup = () => {
      source.unpipe(bb);
      if (live) {
        req.off("data", onData);
        req.off("close", onClose);
      }
    };

    const fail = (e: unknown) => {
      if (failed) return;
      failed = true;
      cleanup();
      if (live) req.resume();
      setImmediate(() => bb.destroy?.());
      reject(e);
    };

    bb.on("field", (name: string, value: string, info: any) => {
      if (info?.nameTruncated || info?.valueTruncated) {
        return fail(tooLarge("Form field too large", maxFieldSize));
      }
      addField(fields, name, value);
    });

    bb.on("file", (field: string, stream: Readable, info: any) => {
      const chunks: Buffer[] = [];
      let size = 0;

      stream.on("data", (c: Buffer) => {
        size += c.length;
        chunks.push(c);
      });
      stream.on("limit", () => fail(tooLarge("File too large", maxFileSize)));
      stream.on("error", () =>
        fail(error.badRequest("Malformed multipart body"))
      );
      stream.on("end", () => {
        if (!info.filename && size === 0) return;
        files.push({
          field,
          filename: info.filename ?? "",
          mimeType: info.mimeType,
          size,
          data: Buffer.concat(chunks, size)
        });
      });
    });

    bb.on("filesLimit", () => fail(tooLarge("Too many files", maxFiles)));
    bb.on("fieldsLimit", () => fail(tooLarge("Too many fields", maxFields)));
    bb.on("partsLimit", () =>
      fail(tooLarge("Too many parts", maxFiles + maxFields))
    );
    bb.on("error", (e: Error) => {
      debug("multipart error", e);
      fail(error.badRequest("Malformed multipart body"));
    });
    bb.on("close", () => {
      if (failed) return;
      cleanup();
      resolve({ fields, files });
    });

    if (live) {
      req.on("data", onData);
      req.on("close", onClose);
    }
    source.pipe(bb);
  });
}
