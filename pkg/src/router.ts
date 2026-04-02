import * as http from "http";
import * as url from "url";

// im gonna kill esm
// import { type WebSocket } from "ws";
type WebSocket = import("ws").WebSocket;

import { createRequire } from "module";

const debug = (...args: any[]) => {
  if (typeof process !== "undefined")
    if (process.env?.HTTPTREE_DEBUG) {
      console.log("[httptree]", ...args);
    }
};

const _require: NodeJS.Require =
  typeof require !== "undefined"
    ? require
    : (createRequire(import.meta.url) as unknown as NodeJS.Require);

let WebSocketServer: typeof import("ws").WebSocketServer | undefined;

function getWebSocketServer() {
  if (WebSocketServer) return WebSocketServer;
  try {
    const mod = _require("ws");
    WebSocketServer = mod.WebSocketServer;
    return WebSocketServer;
  } catch {
    return undefined;
  }
}

type Flat<T> = { [K in keyof T]: T[K] } & {};

type Params<Path extends string> = ParamsInner<Path>;

type ParamsInner<S extends string> = S extends `[[...${infer P}]]/${infer Rest}`
  ? { [K in P]?: string[] }
  : S extends `[[...${infer P}]]/`
    ? { [K in P]?: string[] }
    : S extends `[[...${infer P}]]`
      ? { [K in P]?: string[] }
      : S extends `[...${infer P}]/${infer Rest}`
        ? { [K in P]: string[] }
        : S extends `[...${infer P}]/`
          ? { [K in P]: string[] }
          : S extends `[...${infer P}]`
            ? { [K in P]: string[] }
            : S extends `[[${infer P}]]/${infer Rest}`
              ? { [K in P]?: string } & ParamsInner<Rest>
              : S extends `[[${infer P}]]/`
                ? { [K in P]?: string }
                : S extends `[[${infer P}]]`
                  ? { [K in P]?: string }
                  : S extends `[${infer P}]/${infer Rest}`
                    ? { [K in P]: string } & ParamsInner<Rest>
                    : S extends `[${infer P}]/`
                      ? { [K in P]: string }
                      : S extends `[${infer P}]`
                        ? { [K in P]: string }
                        : S extends `${infer _Segment}/${infer Rest}`
                          ? ParamsInner<Rest>
                          : {};

type Middleware = (
  req: TreeRequest,
  res: http.ServerResponse,
  getNext: () => (err?: Error) => Promise<void>,
) => void | Promise<void> | Promise<TreeResponse> | TreeResponse;

export type TreeRequest<P = Record<string, string | string[] | undefined>> =
  http.IncomingMessage & {
    params: Flat<P>;
    data: Record<string, any>;
  };

const middlewares: Array<{
  fn: Middleware;
  priority: number;
  idx: number;
}> = [];

let _regIdx = 0;

function use(fn: Middleware, priority = 0) {
  debug(`Registering middleware with priority=${priority}, idx=${_regIdx}`);
  middlewares.push({ fn, priority, idx: _regIdx++ });
}

async function runMiddlewares(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  done: (err?: Error) => void,
) {
  const treeReq = req as TreeRequest;
  if (!treeReq.params) treeReq.params = {};
  if (!treeReq.data) treeReq.data = {};

  const list = [...middlewares].sort(
    (a, b) => b.priority - a.priority || a.idx - b.idx,
  );

  let idx = 0;

  async function dispatch(err?: Error): Promise<void> {
    if (err) return done(err);

    const entry = list[idx++];
    if (!entry) return done();

    debug(`Running middleware idx=${entry.idx}, priority=${entry.priority}`);

    let manualMode = false;

    const getNext = () => {
      manualMode = true;
      return async (err?: Error) => {
        await dispatch(err);
      };
    };

    try {
      const ret = await entry.fn(treeReq, res, getNext);

      debug(`Middleware idx=${entry.idx} returned:`, ret);

      if (res.writableEnded) return;

      if (ret && (ret as any)[responseSymbol]) {
        finishResponse(res, ret as TreeResponse);
        return;
      }

      if (!manualMode) {
        await dispatch();
      }
    } catch (e) {
      await dispatch(e instanceof Error ? e : new Error(String(e)));
    }
  }

  await dispatch();
}

const upgradeHandlers: Array<{
  fn: UpgradeHandler;
  priority: number;
  idx: number;
}> = [];

let _upgradeIdx = 0;

function useUpgrade(fn: UpgradeHandler, priority = 0) {
  upgradeHandlers.push({ fn, priority, idx: _upgradeIdx++ });
}

function escapeRE(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PatternInfo = {
  regex: RegExp;
  params: string[];
  score: number;
};

function compilePattern(path: string): PatternInfo {
  if (!path.startsWith("/")) path = "/" + path;
  if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);

  const parts = path.split("/").slice(1).filter(Boolean);
  const params: string[] = [];
  let re = "^";
  let score = 0;

  for (const seg of parts) {
    if (seg.startsWith("[...") && seg.endsWith("]")) {
      params.push("..." + seg.slice(4, -1));
      re += "(?:/(.*))?";
      break;
    }

    if (seg.startsWith("[[") && seg.endsWith("]]")) {
      params.push(seg.slice(2, -2));
      re += "(?:/([^/]+))?";
      score += 1;
      continue;
    }

    if (seg.startsWith("[") && seg.endsWith("]")) {
      params.push(seg.slice(1, -1));
      re += "/([^/]+)";
      score += 1;
      continue;
    }

    re += "/" + escapeRE(seg);
    score += 10;
  }

  if (parts.length === 0) re += "/?";
  re += "/?$";

  return { regex: new RegExp(re), params, score };
}

type HandlerReturn =
  | TreeResponse
  | string
  | Buffer
  | void
  | Promise<TreeResponse | string | Buffer | void>;

type Handler<P extends Record<string, any>> = (
  req: TreeRequest<P>,
  //http.IncomingMessage & { params: Flat<P> },
  res: http.ServerResponse,
) => HandlerReturn;

type WSHandler<P extends Record<string, any> = Record<string, any>> = (
  ws: WebSocket,
  req: TreeRequest<P>,
) => void | Promise<void>;

export type UpgradeHandler = (
  req: http.IncomingMessage,
  socket: any,
  head: Buffer,
) => boolean | void;

type Precheck = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => boolean | Promise<boolean>;

type Route = {
  method: string;
  info: PatternInfo;
  handler: Handler<any>;
  prechecks: Precheck[];
};

type WSRoute = {
  info: PatternInfo;
  handler: WSHandler;
  prechecks: Precheck[];
};

function finishResponse(
  res: http.ServerResponse,
  result: TreeResponse | string | Buffer | void | undefined,
) {
  if (res.writableEnded) return;

  if (!result) {
    return;
  }

  if ((result as any)[responseSymbol]) {
    const r = result as TreeResponse;
    res.statusCode = r.status;
    for (const [k, v] of Object.entries(r.headers || {})) {
      try {
        res.setHeader(k, v);
      } catch {}
    }
    res.end(r.body);
    return;
  }

  if (typeof result === "string" || Buffer.isBuffer(result)) {
    res.statusCode = 200;
    res.end(result);
    return;
  }

  res.statusCode = 204;
  res.end();
}

function finishThrownResponse(res: http.ServerResponse, err: any) {
  if (res.writableEnded) return;

  if (err && typeof err === "object" && (err as any)[responseSymbol]) {
    const r = err as TreeResponse;
    res.statusCode = r.status;
    for (const [k, v] of Object.entries(r.headers || {})) {
      try {
        res.setHeader(k, v);
      } catch {}
    }
    res.end(r.body);
    return;
  }

  res.statusCode = 500;
  res.end("Internal Server Error");
  console.error("Error in handler:", err);
}

class Router<P extends Record<string, string | undefined> = {}> {
  protected base: string;
  protected routes: Route[];
  protected wsRoutes: WSRoute[];
  protected inheritedChecks: Precheck[];
  protected root: Router<any>;
  protected errorHandlers: Map<
    string,
    (err: any, req: http.IncomingMessage, res: http.ServerResponse) => void
  >;

  constructor(
    base = "/",
    root?: Router<any>,
    inheritedChecks: Precheck[] = [],
  ) {
    this.base = normalize(base);
    this.root = root ?? this;
    this.routes = root ? root.routes : [];
    this.wsRoutes = root ? root.wsRoutes : [];
    this.inheritedChecks = inheritedChecks;
    this.errorHandlers = new Map();
    (this as any).parent = undefined;
    // if (!root) {
    //   use(this.handle);
    // }
  }

  handleError(
    type: "NotFound" | "InternalError" | "*",
    handler: (
      err: any,
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => void,
  ) {
    debug(
      `Registering error handler for type '${type}' on base '${this.base}'`,
    );
    this.errorHandlers.set(type, handler);
    return this;
  }

  branch<Path extends string>(
    path: Path,
    check?: Precheck,
  ): Router<P & Params<Path>> {
    let full = join(this.base, path as string);
    debug(
      `Creating branch: parent base='${this.base}', requested path='${path}', full before normalization='${full}'`,
    );
    const normalizedFull = normalize(full);
    debug(`Normalized full path for branch: '${normalizedFull}'`);
    const checks = [...this.inheritedChecks];
    if (check) checks.push(check);
    const branch = new Router<P & Params<Path>>(
      normalizedFull,
      this.root,
      checks,
    );
    (branch as any).parent = this;
    if (!(this as any).branches) (this as any).branches = [];
    (this as any).branches.push(branch);
    debug(
      `Created branch with base '${branch.base}' under parent base '${this.base}'`,
    );
    return branch;
  }

  get<Path extends string>(path: Path, h: Handler<Flat<P & Params<Path>>>) {
    debug(`Registering GET route: base='${this.base}', path='${path}'`);
    return this.add("GET", path as string, h);
  }

  post<Path extends string>(path: Path, h: Handler<Flat<P & Params<Path>>>) {
    debug(`Registering POST route: base='${this.base}', path='${path}'`);
    return this.add("POST", path as string, h);
  }
  put<Path extends string>(path: Path, h: Handler<Flat<P & Params<Path>>>) {
    debug(`Registering PUT route: base='${this.base}', path='${path}'`);
    return this.add("PUT", path as string, h);
  }
  delete<Path extends string>(path: Path, h: Handler<Flat<P & Params<Path>>>) {
    debug(`Registering DELETE route: base='${this.base}', path='${path}'`);
    return this.add("DELETE", path as string, h);
  }
  all<Path extends string>(path: Path, h: Handler<Flat<P & Params<Path>>>) {
    debug(`Registering ALL route: base='${this.base}', path='${path}'`);
    return this.add("*", path as string, h);
  }

  ws<Path extends string>(path: Path, h: WSHandler<Flat<P & Params<Path>>>) {
    debug(`Registering WS route: base='${this.base}', path='${path}'`);
    const WSSCtor = getWebSocketServer();
    if (!WSSCtor) {
      throw new Error(
        "WebSocket support requires the 'ws' package. Please install it first.",
      );
    }
    const full = join(this.base, path as string);
    const info = compilePattern(full);

    this.wsRoutes.push({
      info,
      handler: h as WSHandler,
      prechecks: [...this.inheritedChecks],
    });

    this.wsRoutes.sort((a, b) => b.info.score - a.info.score);

    return this;
  }

  handle = async (req: TreeRequest<P>, res: http.ServerResponse) => {
    const pathname = url.parse(req.url || "/").pathname || "/";
    const method = (req.method || "GET").toUpperCase();

    for (const r of this.routes) {
      if (r.method !== "*" && r.method !== method) continue;

      const m = r.info.regex.exec(pathname);
      if (!m) continue;

      const params: Record<string, string | string[] | undefined> = {};
      r.info.params.forEach((p, i) => {
        debug(`Extracting param '${p}' from segment '${m[i + 1]}'`);
        if (p.startsWith("...")) {
          const val = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined;
          params[p.replace(/^\.\.\./, "")] =
            val !== undefined ? val.split("/").filter(Boolean) : [];
        } else {
          params[p] = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined;
        }
      });

      for (const chk of r.prechecks) {
        const ok = await chk(req, res);
        if (!ok) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
      }

      try {
        req.params = params;
        await r.handler(req, res);

        if (!res.writableEnded) {
          debug(`Route matched but did not send response, defaulting to 204`);
          res.statusCode = 204;
          res.end();
        }
      } catch (e) {
        // return next(e instanceof Error ? e : new Error(String(e)));
        return finishThrownResponse(res, e);
      }

      return;
    }

    // next();
    // return finishThrownResponse(res, {
    //   name: "NotFound",
    //   message: "Not Found",
    // });

    return;
  };

  handleWS = async (ws: WebSocket, req: http.IncomingMessage) => {
    const pathname = url.parse(req.url || "/").pathname || "/";

    for (const r of this.wsRoutes) {
      const m = r.info.regex.exec(pathname);
      if (!m) continue;

      const params: Record<string, string | undefined> = {};
      r.info.params.forEach((p, i) => {
        params[p] = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined;
      });

      const reqWithParams = req as TreeRequest;
      reqWithParams.params = params;
      const reqWithData = reqWithParams as typeof reqWithParams & {
        data: Record<string, any>;
      };

      if (!reqWithData.data) reqWithData.data = {};

      for (const chk of r.prechecks) {
        const ok = await chk(reqWithData, {} as any);
        if (!ok) {
          ws.close(1008, "Forbidden");
          return;
        }
      }

      await r.handler(ws, reqWithData);
      return;
    }

    ws.close(1002, "No WS route");
  };

  protected add(method: string, path: string, handler: Handler<any>) {
    const full = join(this.base, path);
    const info = compilePattern(full);
    debug(
      `Adding route: method='${method}', full path='${full}', regex='${info.regex}', params=[${info.params.join(", ")}]`,
    );

    const wrappedHandler: Handler<any> = async (req, res) => {
      try {
        const result = await handler(req, res);
        finishResponse(res, result);
      } catch (e) {
        // throw e instanceof Error ? e : new Error(String(e));
        finishThrownResponse(res, e);
      }
    };

    this.routes.push({
      method,
      info,
      handler: wrappedHandler,
      prechecks: [...this.inheritedChecks],
    });

    this.routes.sort(
      (a, b) =>
        b.info.score - a.info.score ||
        b.info.regex.source.length - a.info.regex.source.length,
    );

    return this;
  }
}

export class BaseRouter extends Router {
  #server?: import("http").Server;

  handleError(
    type: string,
    handler: (
      err: any,
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => void,
  ) {
    super.handleError(type as any, handler);
    return this;
  }

  listen(port: number, cb?: () => void): Promise<void> | import("http").Server {
    const server = http.createServer((req, res) => {
      runMiddlewares(req, res, (err) => {
        if (err) {
          res.statusCode = 500;
          res.end("Internal Error");
        } else {
          if (res.writableEnded) return;

          this.handle(req as any, res);
          if (!res.writableEnded) {
            const notFoundHandler =
              this.errorHandlers.get("NotFound") || this.errorHandlers.get("*");

            if (notFoundHandler) {
              try {
                notFoundHandler(
                  { name: "NotFound", message: "Not Found" },
                  req,
                  res,
                );
              } catch {
                res.statusCode = 500;
                res.end("Internal Error");
              }
            } else {
              res.statusCode = 404;
              res.end("Not Found");
            }
          }
        }
      });
    });

    this.#server = server;

    const WSSCtor = getWebSocketServer();
    if (WSSCtor) {
      const wss = new WSSCtor({ noServer: true });

      useUpgrade((req, socket, head) => {
        // only accept websocket upgrades
        if (req.headers.upgrade !== "websocket") return false;

        wss.handleUpgrade(req, socket, head, (ws) => {
          this.handleWS(ws, req);
        });

        return true;
      });
    }

    server.on("upgrade", (req, socket, head) => {
      const list = [...upgradeHandlers].sort(
        (a, b) => b.priority - a.priority || a.idx - b.idx,
      );

      for (const h of list) {
        try {
          const handled = h.fn(req, socket, head);
          if (handled) return;
        } catch (e) {
          socket.destroy();
          return;
        }
      }

      // nothing handled it
      socket.destroy();
    });

    if (cb) {
      server.listen(port, cb);
      return server;
    } else {
      return new Promise<void>((resolve, reject) => {
        server.listen(port, () => resolve());
        server.on("error", reject);
      });
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#server) {
        this.#server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        this.#server = undefined;
      } else {
        resolve();
      }
    });
  }

  use(fn: Middleware, priority = 0) {
    use(fn, priority);
  }

  useUpgrade(fn: UpgradeHandler, priority = 0) {
    useUpgrade(fn, priority);
  }
}

function normalize(p: string) {
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+/g, "/");
  if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function join(a: string, b: string) {
  if (a !== "/" && a.endsWith("/")) a = a.slice(0, -1);
  b = b.replace(/^\/+/, "");
  if (!b) return a;
  return a + "/" + b;
}

export function root(base = "/") {
  return new BaseRouter(base);
}

export const responseSymbol = Symbol("httptree.response");

export interface TreeResponse {
  [responseSymbol]: true;
  body: string | Buffer | NodeJS.ReadableStream;
  status: number;
  headers: Record<string, string>;
}

function createResponse(
  body: string | Buffer | NodeJS.ReadableStream,
  status = 200,
  headers: Record<string, string> = {},
): TreeResponse {
  return {
    [responseSymbol]: true,
    body,
    status,
    headers,
  };
}

export function json(
  data: unknown,
  opts: { status?: number; headers?: Record<string, string> } = {},
): TreeResponse {
  return createResponse(JSON.stringify(data), opts.status ?? 200, {
    "Content-Type": "application/json; charset=utf-8",
    ...opts.headers,
  });
}

export function text(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {},
): TreeResponse {
  return createResponse(body, opts.status ?? 200, {
    "Content-Type": "text/plain; charset=utf-8",
    ...opts.headers,
  });
}

export function redirect(
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 302,
) {
  return {
    [responseSymbol]: true,
    body: "",
    status,
    headers: {
      Location: location,
    },
  } satisfies TreeResponse;
}

function _error(
  status: number,
  body: string | object = http.STATUS_CODES[status] ?? "Error",
  headers: Record<string, string> = {},
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
      ...headers,
    },
  } satisfies TreeResponse;
}

const error = _error as typeof _error & {
  badRequest: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  unauthorized: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  forbidden: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  notFound: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  conflict: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  unprocessableEntity: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  tooManyRequests: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  internalServerError: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  badGateway: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
  serviceUnavailable: (
    body?: string | object,
    headers?: Record<string, string>,
  ) => TreeResponse;
};

(error as any).badRequest = (
  body: string | object = "Bad Request",
  headers: Record<string, string> = {},
) => _error(400, body, headers);
(error as any).unauthorized = (
  body: string | object = "Unauthorized",
  headers: Record<string, string> = {},
) => _error(401, body, headers);
(error as any).forbidden = (
  body: string | object = "Forbidden",
  headers: Record<string, string> = {},
) => _error(403, body, headers);
(error as any).notFound = (
  body: string | object = "Not Found",
  headers: Record<string, string> = {},
) => _error(404, body, headers);
(error as any).conflict = (
  body: string | object = "Conflict",
  headers: Record<string, string> = {},
) => _error(409, body, headers);
(error as any).unprocessableEntity = (
  body: string | object = "Unprocessable Entity",
  headers: Record<string, string> = {},
) => _error(422, body, headers);
(error as any).tooManyRequests = (
  body: string | object = "Too Many Requests",
  headers: Record<string, string> = {},
) => _error(429, body, headers);
(error as any).internalServerError = (
  body: string | object = "Internal Server Error",
  headers: Record<string, string> = {},
) => _error(500, body, headers);
(error as any).badGateway = (
  body: string | object = "Bad Gateway",
  headers: Record<string, string> = {},
) => _error(502, body, headers);
(error as any).serviceUnavailable = (
  body: string | object = "Service Unavailable",
  headers: Record<string, string> = {},
) => _error(503, body, headers);

export { error };

export function raw(
  body: Buffer,
  opts: { status?: number; headers?: Record<string, string> } = {},
): TreeResponse {
  return createResponse(body, opts.status ?? 200, opts.headers ?? {});
}

export function file(
  body: Buffer,
  filename: string,
  contentType = "application/octet-stream",
): TreeResponse {
  return createResponse(body, 200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
}

export function stream(
  stream: NodeJS.ReadableStream,
  opts: { status?: number; headers?: Record<string, string> } = {},
): TreeResponse {
  return createResponse(stream, opts.status ?? 200, opts.headers ?? {});
}

export function html(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {},
): TreeResponse {
  return createResponse(body, opts.status ?? 200, {
    "Content-Type": "text/html; charset=utf-8",
    ...opts.headers,
  });
}
