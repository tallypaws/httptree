import * as http from "http";
import { Readable, pipeline, type Duplex } from "stream";
import { debug } from "./util.js";

/**
 * marks an object as a {@link TreeResponse}, you should not need it
 *
 * @category Misc
 */
export const responseSymbol = Symbol("httptree.response");

/**
 * returnable response body that the router will automatically handle
 *
 * created with {@link json}, {@link text}, {@link html}, etc etc
 *
 * return it from a handler or throw, see {@link HandlerReturn}
 *
 * @category Responses
 */
export interface TreeResponse {
  [responseSymbol]: true;
  /** string, bytes or a stream
   * streams are piped
   */
  body: string | Buffer | NodeJS.ReadableStream;
  /** http status code */
  status: number;
  /** response headers, an array sends the header once per value (eg. `Set-Cookie`) */
  headers: Record<string, string | string[]>;
}

/**
 * `true` if value is a {@link TreeResponse}
 *
 * @category Misc
 */
export function isTreeResponse(value: unknown): value is TreeResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any)[responseSymbol] === true
  );
}

/**
 * {@link TreeResponse} builder
 *
 * @category Misc
 */
export function createResponse(
  body: string | Buffer | NodeJS.ReadableStream,
  status = 200,
  headers: Record<string, string | string[]> = {}
): TreeResponse {
  return { [responseSymbol]: true, body, status, headers };
}

/**
 * sends a value as JSON (`Content-Type: application/json`)
 * `undefined` is sent as `null`
 *
 * @example
 * ```ts
 * tree.get("/user", () => json({ name: "tally" }));
 * tree.post("/user", () => json({ id: 1 }, { status: 201 }));
 * ```
 *
 * @param data anything `JSON.stringify` accepts
 * @param [opts] `status` (default 200) and extra `headers`
 *
 * @category Responses
 */
export function json(
  data: unknown,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(JSON.stringify(data) ?? "null", opts.status ?? 200, {
    "Content-Type": "application/json; charset=utf-8",
    ...opts.headers
  });
}

/**
 * sends plain text (`Content-Type: text/plain`)
 *
 * @example
 * ```ts
 * tree.get("/", () => text("hello"));
 * ```
 *
 * @param [opts] `status` (default 200) and extra `headers`
 *
 * @category Responses
 */
export function text(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(body, opts.status ?? 200, {
    "Content-Type": "text/plain; charset=utf-8",
    ...opts.headers
  });
}

/**
 * redirects to another location
 *
 *  - `301` / `308` permanent
 *  - `302` / `307` temporary
 *    - `307` and `308` keep the method and body
 *  - `303` see other
 *
 * @example
 * ```ts
 * tree.get("/old", () => redirect("/new", 301));
 * ```
 *
 * @param [status] status code (default 302)
 *
 * @category Responses
 */
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

/**
 * builds an error response
 * throwing one works the same as returning it
 *
 * Helpers:
 * - `badRequest` (400)
 * - `unauthorized` (401)
 * - `forbidden` (403)
 * - `notFound` (404)
 * - `methodNotAllowed` (405)
 * - `conflict` (409)
 * - `payloadTooLarge` (413)
 * - `unsupportedMediaType` (415)
 * - `unprocessableEntity` (422)
 * - `tooManyRequests` (429)
 * - `internalServerError` (500)
 * - `badGateway` (502)
 * - `serviceUnavailable` (503)
 *
 * @example
 * ```ts
 * tree.get("/users/[id]", (req) => {
 *   const user = db.users.get(req.params.id);
 *   if (!user) throw error.notFound();
 *   return user;
 * });
 *
 * error.badRequest("name is required");
 * error.unprocessableEntity({ field: "name", problem: "too short" });
 * error.methodNotAllowed(undefined, { Allow: "GET" });
 * error(418, "im a teapot");
 * ```
 *
 * @param [body] text or an object (sent as JSON), default is the status text
 *
 * @category Responses
 */
// do not even play around kid
const error = _error as typeof _error & {
  /**
   * `400` the request itself is wrong (missing or malformed input)
   *
   * @example
   * ```ts
   * tree.post("/echo", async (req) => {
   *   const { message } = await req.getJSON<{ message?: string }>();
   *   if (!message) throw error.badRequest("message is required");
   *   return message;
   * });
   * ```
   */
  badRequest: ErrorFn;
  /**
   * `401` not logged in, send a `WWW-Authenticate` header to tell the client how to
   *
   * @example
   * ```ts
   * tree.use((req) => {
   *   if (!req.headers.authorization) {
   *     throw error.unauthorized("log in first", { "WWW-Authenticate": "Bearer" });
   *   }
   * });
   * ```
   */
  unauthorized: ErrorFn;
  /**
   * `403` logged in, but not allowed to do this
   *
   * @example
   * ```ts
   * tree.delete("/posts/[id]", (req) => {
   *   if (!req.data.user.isAdmin) throw error.forbidden();
   *   db.posts.remove(req.params.id);
   * });
   * ```
   */
  forbidden: ErrorFn;
  /**
   * `404` the thing doesn't exist
   *
   * @example
   * ```ts
   * tree.get("/users/[id]", (req) => {
   *   const user = db.users.get(req.params.id);
   *   if (!user) throw error.notFound("no such user");
   *   return user;
   * });
   * ```
   */
  notFound: ErrorFn;
  /**
   * `405` the path exists but not for this method, list the allowed ones in `Allow`
   *
   * > [!NOTE]
   * > this is already done for you
   *
   * @example
   * ```ts
   * tree.all("/export", () => error.methodNotAllowed(undefined, { Allow: "GET" }));
   * ```
   */
  methodNotAllowed: ErrorFn;
  /**
   * `409` conflicts with the current state
   *
   * @example
   * ```ts
   * tree.post("/users", async (req) => {
   *   const { name } = await req.getJSON<{ name: string }>();
   *   if (db.users.has(name)) throw error.conflict("name is taken");
   *   return db.users.add(name);
   * });
   * ```
   */
  conflict: ErrorFn;
  /**
   * `413` the body is bigger than allowed
   *
   * > [!NOTE]
   * > the body helpers already handle this
   *
   * > [!WARNING]
   * > checking the size yourself only happens *after* the whole body is in memory, which can OOM you
   * > pass `maxSize` to `getBuffer` (or any other helper) instead, it stops reading as soon as the limit is hit
   *
   * @example
   * ```ts
   * tree.post("/avatar", async (req) => {
   *   const img = await req.getBuffer();
   *   if (img.length > 256_000) throw error.payloadTooLarge("max 250kb");
   * });
   * ```
   */
  payloadTooLarge: ErrorFn;
  /**
   * `415` the `Content-Type` is invalid
   *
   * @example
   * ```ts
   * tree.post("/import", (req) => {
   *   if (req.headers["content-type"] !== "text/csv") throw error.unsupportedMediaType("send csv");
   *   // ...
   * });
   * ```
   */
  unsupportedMediaType: ErrorFn;
  /**
   * `422` the body is well formed, but is still invalid
   *
   * @example
   * ```ts
   * tree.post("/users", async (req) => {
   *   const { name } = await req.getJSON<{ name: string }>();
   *   if (name.length < 3) {
   *     throw error.unprocessableEntity({ field: "name", problem: "too short" });
   *   }
   * });
   * ```
   */
  unprocessableEntity: ErrorFn;
  /**
   * `429` rate limited, `Retry-After` says when to retry
   *
   * @example
   * ```ts
   * tree.use((req) => {
   *   if (limiter.isLimited(req.socket.remoteAddress)) {
   *     throw error.tooManyRequests(undefined, { "Retry-After": "30" });
   *   }
   * });
   * ```
   */
  tooManyRequests: ErrorFn;
  /**
   * `500` something broke on your side
   * all errors become this eventually
   * use manually for custom bodies
   *
   * @example
   * ```ts
   * tree.get("/die", async () => {
   *   try {
   *     return await die();
   *   } catch {
   *     throw error.internalServerError("failed to die, i resist.");
   *   }
   * });
   * ```
   */
  internalServerError: ErrorFn;
  /**
   * `502` a server you depend on gave a bad answer
   *
   * @example
   * ```ts
   * tree.get("/weather", async () => {
   *   const res = await fetch("https://weather.example/api");
   *   if (!res.ok) throw error.badGateway("weather service failed");
   *   return res.json();
   * });
   * ```
   */
  badGateway: ErrorFn;
  /**
   * `503` temporarily unavailable, `Retry-After` says when to retry
   *
   * @example
   * ```ts
   * tree.use(() => {
   *   if (maintenance) throw error.serviceUnavailable("back soon", { "Retry-After": "600" });
   * }, 10);
   * ```
   */
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

/**
 * sends bytes as they are, set the `Content-Type` yourself in `headers`
 *
 * @param [opts] `status` (default 200) and `headers`
 *
 * @category Responses
 */
export function raw(
  body: Buffer,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(body, opts.status ?? 200, opts.headers ?? {});
}

/**
 * sends bytes as a download (`Content-Disposition: attachment`)
 *
 * > [!WARNING]
 * > the file name is used as is, so do not pass unchecked user input
 *
 * @example
 * ```ts
 * tree.get("/report", () => file(csvBuffer, "report.csv", "text/csv"));
 * ```
 *
 * @param filename name the browser saves it as
 * @param [contentType] mime type (default `application/octet-stream`)
 *
 * @category Responses
 */
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

/**
 * streams a node readable as the response body
 *
 * @example
 * ```ts
 * tree.get("/video", () => stream(createReadStream("video.mp4"), { headers: { "Content-Type": "video/mp4" } }));
 * ```
 *
 * @param [opts] `status` (default 200) and `headers`
 *
 * @category Responses
 */
export function stream(
  stream: NodeJS.ReadableStream,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(stream, opts.status ?? 200, opts.headers ?? {});
}

/**
 * sends html (`Content-Type: text/html`)
 *
 * @example
 * ```ts
 * tree.get("/", () => html("<h1>hi</h1>"));
 * ```
 *
 * @param [opts] `status` (default 200) and extra `headers`
 *
 * @category Responses
 */
export function html(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {}
): TreeResponse {
  return createResponse(body, opts.status ?? 200, {
    "Content-Type": "text/html; charset=utf-8",
    ...opts.headers
  });
}

/**
 * turns whatever a handler returned into a response, see {@link HandlerReturn}
 * `undefined` and `null` give `undefined`
 *
 * @returns the response, or `undefined` if there is nothing to send
 * @throws `TypeError` for values that cannot be sent (functions, symbols, bigints)
 *
 * @category Misc
 */
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

/**
 * writes a response straight to an upgrade socket as plain http and ends it
 * only for rejecting an upgrade before the handshake
 */
export function flushUpgradeResponse(socket: Duplex, r: TreeResponse) {
  const body = r.body as any;
  const isStream = body && typeof body === "object" && "pipe" in body;
  const data = isStream
    ? undefined
    : typeof body === "string"
      ? Buffer.from(body)
      : (body as Buffer);

  const headers: Record<string, string | string[]> = {
    Connection: "close",
    ...(data ? { "Content-Length": String(data.length) } : {}),
    ...r.headers
  };

  const lines = [
    `HTTP/1.1 ${r.status} ${http.STATUS_CODES[r.status] ?? "Unknown"}`
  ];

  for (const [k, v] of Object.entries(headers)) {
    for (const value of Array.isArray(v) ? v : [v]) {
      if (/[\r\n]/.test(k) || /[\r\n]/.test(String(value))) {
        debug(`invalid header '${k}' skipped`);
        continue;
      }
      lines.push(`${k}: ${value}`);
    }
  }

  if (socket.destroyed) {
    if (isStream) body.destroy?.();
    return;
  }

  socket.write(lines.join("\r\n") + "\r\n\r\n");

  if (isStream) {
    pipeline(body, socket, (err) => {
      if (err) debug("stream response failed", err);
    });
    return;
  }

  socket.end(data);
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
