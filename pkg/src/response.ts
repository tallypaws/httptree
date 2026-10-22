import * as http from "http";
import { Readable, pipeline } from "stream";
import { debug } from "./util.js";

export const responseSymbol = Symbol("httptree.response");

export interface TreeResponse {
  [responseSymbol]: true;
  body: string | Buffer | NodeJS.ReadableStream;
  status: number;
  headers: Record<string, string | string[]>;
}

export function isTreeResponse(value: unknown): value is TreeResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any)[responseSymbol] === true
  );
}

export function createResponse(
  body: string | Buffer | NodeJS.ReadableStream,
  status = 200,
  headers: Record<string, string | string[]> = {}
): TreeResponse {
  return { [responseSymbol]: true, body, status, headers };
}

export function json(
  data: unknown,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(JSON.stringify(data) ?? "null", opts.status ?? 200, {
    "Content-Type": "application/json; charset=utf-8",
    ...opts.headers
  });
}

export function text(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(body, opts.status ?? 200, {
    "Content-Type": "text/plain; charset=utf-8",
    ...opts.headers
  });
}

export function redirect(
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 302
) {
  return {
    [responseSymbol]: true,
    body: "",
    status,
    headers: { Location: location }
  } satisfies TreeResponse;
}

function _error(
  status: number,
  body: string | object = http.STATUS_CODES[status] ?? "Error",
  headers: Record<string, string> = {}
) {
  const isJSON = typeof body === "object";

  return {
    [responseSymbol]: true,
    body: isJSON ? JSON.stringify(body) : String(body),
    status,
    headers: {
      "Content-Type": isJSON
        ? "application/json; charset=utf-8"
        : "text/plain; charset=utf-8",
      ...headers
    }
  } satisfies TreeResponse;
}

type ErrorFn = (
  body?: string | object,
  headers?: Record<string, string>
) => TreeResponse;

// do not even play around kid
const error = _error as typeof _error & {
  badRequest: ErrorFn;
  unauthorized: ErrorFn;
  forbidden: ErrorFn;
  notFound: ErrorFn;
  methodNotAllowed: ErrorFn;
  conflict: ErrorFn;
  payloadTooLarge: ErrorFn;
  unsupportedMediaType: ErrorFn;
  unprocessableEntity: ErrorFn;
  tooManyRequests: ErrorFn;
  internalServerError: ErrorFn;
  badGateway: ErrorFn;
  serviceUnavailable: ErrorFn;
};

const errorHelpers: Record<string, number> = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  conflict: 409,
  payloadTooLarge: 413,
  unsupportedMediaType: 415,
  unprocessableEntity: 422,
  tooManyRequests: 429,
  internalServerError: 500,
  badGateway: 502,
  serviceUnavailable: 503
};

for (const [name, status] of Object.entries(errorHelpers)) {
  (error as any)[name] = (
    body: string | object = http.STATUS_CODES[status] ?? "Error",
    headers: Record<string, string> = {}
  ) => _error(status, body, headers);
}

export { error };

export function raw(
  body: Buffer,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(body, opts.status ?? 200, opts.headers ?? {});
}

export function file(
  body: Buffer,
  filename: string,
  contentType = "application/octet-stream"
): TreeResponse {
  return createResponse(body, 200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`
  });
}

export function stream(
  stream: NodeJS.ReadableStream,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(stream, opts.status ?? 200, opts.headers ?? {});
}

export function html(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(body, opts.status ?? 200, {
    "Content-Type": "text/html; charset=utf-8",
    ...opts.headers
  });
}

export function toTreeResponse(value: unknown): TreeResponse | undefined {
  if (value === undefined || value === null) return undefined;
  if (isTreeResponse(value)) return value;

  switch (typeof value) {
    case "string":
      return text(value);
    case "number":
    case "boolean":
      return json(value);
    case "object":
      break;
    default:
      throw new TypeError(
        `httptree: a handler returned an unsupported value (${typeof value})`
      );
  }

  const octet = { "Content-Type": "application/octet-stream" };

  if (Buffer.isBuffer(value)) return raw(value, { headers: octet });

  if (value instanceof Uint8Array) {
    return raw(Buffer.from(value.buffer, value.byteOffset, value.byteLength), {
      headers: octet
    });
  }

  if (typeof (value as any).pipe === "function") {
    return stream(value as NodeJS.ReadableStream);
  }

  if (
    typeof ReadableStream !== "undefined" &&
    value instanceof ReadableStream
  ) {
    return stream(Readable.fromWeb(value as any));
  }

  if (typeof Response !== "undefined" && value instanceof Response) {
    const headers: Record<string, string | string[]> = {};
    value.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const cookies = (value.headers as any).getSetCookie?.() as
      | string[]
      | undefined;
    if (cookies?.length) headers["set-cookie"] = cookies;

    return createResponse(
      value.body ? Readable.fromWeb(value.body as any) : "",
      value.status,
      headers
    );
  }

  return json(value);
}

export function flushResponse(
  res: http.ServerResponse,
  r: TreeResponse,
  isHead = false
) {
  const body = r.body as any;
  const isStream = body && typeof body === "object" && "pipe" in body;

  if (res.headersSent || res.writableEnded || res.destroyed) {
    debug("the response was already sent");
    if (isStream) body.destroy?.();
    return;
  }

  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers || {})) {
    try {
      res.setHeader(k, v);
    } catch (e) {
      debug(`invalid header '${k}' skipped`, e);
    }
  }

  if (isStream) {
    if (isHead) {
      body.destroy?.();
      res.end();
      return;
    }
    pipeline(body, res, (err) => {
      if (err) debug("stream response failed", err);
    });
    return;
  }

  res.end(body);
}
