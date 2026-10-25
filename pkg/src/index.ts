import * as http from "http";

// im gonna kill esm
// import { type WebSocket } from "ws";
type WebSocket = import("ws").WebSocket;

import { _require, debug, parseSize, type Flat } from "./util.js";
import {
  createResponse,
  error,
  flushResponse,
  isTreeResponse,
  toTreeResponse,
  type TreeResponse
} from "./response.js";
import {
  ensureTreeRequest,
  stateOf,
  TreeRequest,
  type HttpTreeRequest
} from "./request.js";
import type { BodyConfig } from "./body.js";

export {
  responseSymbol,
  json,
  text,
  redirect,
  error,
  raw,
  file,
  stream,
  html,
  type TreeResponse
} from "./response.js";
export {
  TreeRequest,
  type HttpTreeRequest,
  type TreeRequestExtras
} from "./request.js";
export type {
  BodyConfig,
  BufferOptions,
  FormOptions,
  JSONOptions,
  ParsedForm,
  Size,
  TextOptions,
  UploadedFile
} from "./body.js";

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

type Params<S extends string> = S extends `[[...${infer P}]]/${infer _Rest}`
  ? { [K in P]?: string[] }
  : S extends `[[...${infer P}]]/`
    ? { [K in P]?: string[] }
    : S extends `[[...${infer P}]]`
      ? { [K in P]?: string[] }
      : S extends `[...${infer P}]/${infer _Rest}`
        ? { [K in P]: string[] }
        : S extends `[...${infer P}]/`
          ? { [K in P]: string[] }
          : S extends `[...${infer P}]`
            ? { [K in P]: string[] }
            : S extends `[[${infer P}]]/${infer Rest}`
              ? { [K in P]?: string } & Params<Rest>
              : S extends `[[${infer P}]]/`
                ? { [K in P]?: string }
                : S extends `[[${infer P}]]`
                  ? { [K in P]?: string }
                  : S extends `[${infer P}]/${infer Rest}`
                    ? { [K in P]: string } & Params<Rest>
                    : S extends `[${infer P}]/`
                      ? { [K in P]: string }
                      : S extends `[${infer P}]`
                        ? { [K in P]: string }
                        : S extends `${infer _Segment}/${infer Rest}`
                          ? Params<Rest>
                          : {};

export type HandlerReturn =
  | object
  | string
  | number
  | boolean
  | null
  | undefined
  | void
  | Promise<object | string | number | boolean | null | undefined | void>;

export type HttpTreeNext = () => (err?: Error) => Promise<void>;

export type HttpTreeMiddleware<
  P extends Record<string, any> = Record<string, string | string[]>
> = (
  req: HttpTreeRequest<P>,
  res: http.ServerResponse,
  getNext: HttpTreeNext
) => HandlerReturn;

function escapeRE(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PatternInfo = { regex: RegExp; params: string[]; score: number };

function compilePattern(path: string, prefix = false): PatternInfo {
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

  if (prefix) {
    re += "(?=/|$)";
  } else {
    if (parts.length === 0) re += "/?";
    re += "/?$";
  }

  return { regex: new RegExp(re), params, score };
}

type RouteParams = Record<string, string | string[]>;

function extractParams(info: PatternInfo, m: RegExpExecArray): RouteParams {
  const params: RouteParams = {};
  info.params.forEach((p, i) => {
    debug(`Extracting param '${p}' from segment '${m[i + 1]}'`);
    if (p.startsWith("...")) {
      const val = m[i + 1] ? decodeURIComponent(m[i + 1]!) : undefined;
      params[p.replace(/^\.\.\./, "")] =
        val !== undefined ? val.split("/").filter(Boolean) : [];
    } else if (m[i + 1]) {
      params[p] = decodeURIComponent(m[i + 1]!);
    }
  });
  return params;
}

function getPathname(rawUrl: string | undefined) {
  let u = rawUrl || "/";
  if (u[0] !== "/") {
    try {
      u = new URL(u).pathname;
    } catch {
      return "/";
    }
  }
  const q = u.search(/[?#]/);
  return q === -1 ? u : u.slice(0, q);
}

export type HttpTreeHandler<P extends Record<string, any>> = (
  req: HttpTreeRequest<P>,
  res: http.ServerResponse,
  getNext: HttpTreeNext
) => HandlerReturn;

export type HttpTreeErrorHandler = (
  err: any,
  req: HttpTreeRequest,
  res: http.ServerResponse
) => HandlerReturn;

export type HttpTreeWSHandler<
  P extends Record<string, any> = Record<string, any>
> = (ws: WebSocket, req: HttpTreeRequest<P>) => void | Promise<void>;

export type HttpTreeUpgradeHandler = (
  req: http.IncomingMessage,
  socket: any,
  head: Buffer
) => boolean | void;

export type HttpTreePrecheck = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => boolean | Promise<boolean>;

export type HttpTreeRoute = {
  method: string;
  info: PatternInfo;
  handler: HttpTreeHandler<any>;
  prechecks: HttpTreePrecheck[];
  path: string;
  priority: number;
  idx: number;
  router: Router<any>;
};

export type HttpTreeMiddlewareEntry = {
  fn: HttpTreeMiddleware<any>;
  priority: number;
  idx: number;
  scope?: PatternInfo;
  router: Router<any>;
};

export type HttpTreeWSRoute = {
  info: PatternInfo;
  handler: HttpTreeWSHandler;
  prechecks: HttpTreePrecheck[];
  path: string;
  router: Router<any>;
};

export interface HttpTreeOptions {
  body?: BodyConfig;
}

type ChainItem = {
  kind: "middleware" | "route" | "fallback";
  priority: number;
  idx: number;
  fn: (
    req: any,
    res: http.ServerResponse,
    getNext: HttpTreeNext
  ) => HandlerReturn;
  router: Router<any>;
  params: RouteParams;
  prechecks?: HttpTreePrecheck[];
};

const compareItems = (a: ChainItem, b: ChainItem) =>
  b.priority - a.priority || a.idx - b.idx;

function findErrorHandler(router: Router<any> | undefined, type: string) {
  for (let r = router; r; r = r.parent) {
    const h = r.errorHandlers.get(type) ?? r.errorHandlers.get("*");
    if (h) return h;
  }
  return undefined;
}

async function renderError(
  router: Router<any>,
  req: HttpTreeRequest,
  res: http.ServerResponse,
  err: any
): Promise<TreeResponse | undefined> {
  const name = err?.name;
  const type =
    name === "NotFound"
      ? "NotFound"
      : name === "MethodNotAllowed"
        ? "MethodNotAllowed"
        : "InternalError";

  const handler = findErrorHandler(router, type);

  if (handler) {
    try {
      const out = await handler(err, req, res);
      if (res.headersSent || res.writableEnded) return undefined;
      const r = toTreeResponse(out);
      if (r) return r;
    } catch (e) {
      console.error("Error inside error handler:", e);
    }
  }

  if (name === "NotFound") return error.notFound();
  if (name === "MethodNotAllowed") {
    return error.methodNotAllowed(undefined, {
      Allow: (err.allow as string[]).join(", ")
    });
  }

  console.error("Error in handler:", err);
  return error.internalServerError();
}

class Router<P extends Record<string, string> = {}> {
  protected base: string;
  protected routes: HttpTreeRoute[];
  protected wsRoutes: HttpTreeWSRoute[];
  protected middlewares: HttpTreeMiddlewareEntry[];
  protected inheritedChecks: HttpTreePrecheck[];
  protected root: Router<any>;
  protected seq = 0;
  protected branches: Router<any>[] = [];
  protected guarded = false;
  public parent?: Router<any>;

  public bodyConfig: BodyConfig = {};

  public errorHandlers: Map<string, HttpTreeErrorHandler>;

  constructor(
    base = "/",
    root?: Router<any>,
    inheritedChecks: HttpTreePrecheck[] = []
  ) {
    this.base = normalize(base);
    this.root = root ?? this;
    this.routes = root ? root.routes : [];
    this.wsRoutes = root ? root.wsRoutes : [];
    this.middlewares = root ? root.middlewares : [];
    this.inheritedChecks = inheritedChecks;
    this.errorHandlers = new Map();
  }

  protected nextIdx() {
    return this.root.seq++;
  }

  handleError(
    type: "NotFound" | "MethodNotAllowed" | "InternalError" | "*",
    handler: HttpTreeErrorHandler
  ) {
    debug(
      `Registering error handler for type '${type}' on base '${this.base}'`
    );
    this.errorHandlers.set(type, handler);
    return this;
  }

  branch<Path extends string>(
    path: Path,
    check?: HttpTreePrecheck
  ): Router<P & Params<Path>> {
    let full = join(this.base, path as string);
    debug(
      `branch: parent base='${this.base}', requested path='${path}', full before normalization='${full}'`
    );
    const normalizedFull = normalize(full);
    debug(`normalized full path for branch: '${normalizedFull}'`);
    const checks = [...this.inheritedChecks];
    if (check) checks.push(check);
    const branch = new Router<P & Params<Path>>(
      normalizedFull,
      this.root,
      checks
    );
    branch.parent = this;
    branch.guarded = !!check;
    this.branches.push(branch);
    debug(`branch with base '${branch.base}' under parent base '${this.base}'`);
    return branch;
  }

  /**
   * registers middleware callback functions
   *
   *  - higher priority runs first then registered first runs first
   *  - route handlers have a priority of 0
   *  - negative priorities run after handlers
   */
  use(fn: HttpTreeMiddleware<Flat<P>>, priority = 1) {
    debug(`Registering middleware on '${this.base}' with priority=${priority}`);
    this.middlewares.push({
      fn: fn as HttpTreeMiddleware<any>,
      priority,
      idx: this.nextIdx(),
      scope:
        this === this.root || this.base === "/"
          ? undefined
          : compilePattern(this.base, true),
      router: this
    });
    return this;
  }

  get<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>>,
    priority = 0
  ) {
    debug(`Registering GET route: base='${this.base}', path='${path}'`);
    return this.add("GET", path as string, h, priority);
  }

  post<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>>,
    priority = 0
  ) {
    debug(`Registering POST route: base='${this.base}', path='${path}'`);
    return this.add("POST", path as string, h, priority);
  }
  patch<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>>,
    priority = 0
  ) {
    debug(`Registering PATCH route: base='${this.base}', path='${path}'`);
    return this.add("PATCH", path as string, h, priority);
  }
  put<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>>,
    priority = 0
  ) {
    debug(`Registering PUT route: base='${this.base}', path='${path}'`);
    return this.add("PUT", path as string, h, priority);
  }
  delete<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>>,
    priority = 0
  ) {
    debug(`Registering DELETE route: base='${this.base}', path='${path}'`);
    return this.add("DELETE", path as string, h, priority);
  }
  all<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>>,
    priority = 0
  ) {
    debug(`Registering ALL route: base='${this.base}', path='${path}'`);
    return this.add("*", path as string, h, priority);
  }

  ws<Path extends string>(
    path: Path,
    h: HttpTreeWSHandler<Flat<P & Params<Path>>>
  ) {
    debug(`Registering WS route: base='${this.base}', path='${path}'`);
    const WSSCtor = getWebSocketServer();
    if (!WSSCtor) {
      throw new Error(
        "WebSocket support requires the 'ws' package. Please install it first."
      );
    }
    const full = join(this.base, path as string);
    const info = compilePattern(full);

    this.wsRoutes.push({
      info,
      handler: h as HttpTreeWSHandler,
      prechecks: [...this.inheritedChecks],
      path: path as string,
      router: this
    });

    this.wsRoutes.sort((a, b) => b.info.score - a.info.score);

    return this;
  }

  /**
   * Displays this router as a hiarchy tree
   *
   * @example
   * ```ts
   * const tree = root();
   * tree.use(logger);
   * tree.get("/", () => "hi");
   * const api = tree.branch("/api", isAuthed);
   * api.get("/users/[id]", () => "user");
   *
   * tree.print();
   * // /
   * // ├─ use logger (priority 1)
   * // ├─ GET    /
   * // └─ /api [precheck]
   * //    └─ GET    /users/[id]
   * ```
   */
  print(log: (text: string) => void = console.log): string {
    const text = this.toString();
    log(text);
    return text;
  }

  /** the same drawing as {@link print} without logging it */
  toString(): string {
    const lines = [this.base];
    this.drawChildren("", lines);
    return lines.join("\n");
  }

  private drawChildren(prefix: string, lines: string[]) {
    const leaves: { idx: number; text: string }[] = [];

    for (const m of this.middlewares) {
      if (m.router !== this) continue;
      const name = m.fn.name ? ` ${m.fn.name}` : "";
      leaves.push({ idx: m.idx, text: `use${name} (priority ${m.priority})` });
    }

    for (const r of this.routes) {
      if (r.router !== this) continue;
      const method = (r.method === "*" ? "ALL" : r.method).padEnd(6);
      const priority = r.priority !== 0 ? ` (priority ${r.priority})` : "";
      leaves.push({
        idx: r.idx,
        text: `${method} ${normalize(r.path)}${priority}`
      });
    }

    leaves.sort((a, b) => a.idx - b.idx);

    const nodes: { text: string; branch?: Router<any> }[] = leaves;

    for (const w of this.wsRoutes) {
      if (w.router !== this) continue;
      nodes.push({ text: `${"WS".padEnd(6)} ${normalize(w.path)}` });
    }

    for (const type of this.errorHandlers.keys()) {
      nodes.push({ text: `error ${type}` });
    }

    for (const b of this.branches) {
      const rel = b.base.startsWith(this.base === "/" ? "" : this.base)
        ? b.base.slice(this.base === "/" ? 0 : this.base.length) || "/"
        : b.base;
      nodes.push({ text: rel + (b.guarded ? " [precheck]" : ""), branch: b });
    }

    nodes.forEach((node, i) => {
      const last = i === nodes.length - 1;
      lines.push(prefix + (last ? "└─ " : "├─ ") + node.text);
      node.branch?.drawChildren(prefix + (last ? "   " : "│  "), lines);
    });
  }

  protected resolveChain(pathname: string, method: string): ChainItem[] {
    let route: HttpTreeRoute | undefined;
    let routeParams: RouteParams | undefined;
    let malformed = false;
    const allowed = new Set<string>();

    for (const r of this.routes) {
      const m = r.info.regex.exec(pathname);
      if (!m) continue;

      if (r.method !== "*" && r.method !== method) {
        allowed.add(r.method);
        continue;
      }

      try {
        routeParams = extractParams(r.info, m);
        route = r;
      } catch {
        malformed = true;
      }
      break;
    }

    const items: ChainItem[] = [];

    for (const mw of this.middlewares) {
      let params: RouteParams = routeParams ?? {};

      if (mw.scope) {
        const m = mw.scope.regex.exec(pathname);
        if (!m) continue;
        if (!routeParams) {
          try {
            params = extractParams(mw.scope, m);
          } catch {
            params = {};
          }
        }
      }

      items.push({
        kind: "middleware",
        priority: mw.priority,
        idx: mw.idx,
        fn: mw.fn,
        router: mw.router,
        params
      });
    }

    if (route) {
      items.push({
        kind: "route",
        priority: route.priority,
        idx: route.idx,
        fn: route.handler,
        router: route.router,
        params: routeParams!,
        prechecks: route.prechecks
      });
    } else {
      items.push({
        kind: "fallback",
        priority: 0,
        idx: Number.MAX_SAFE_INTEGER,
        router: this,
        params: {},
        fn: () => {
          if (malformed) throw error.badRequest("Malformed URL");
          if (allowed.size) {
            throw Object.assign(new Error("Method Not Allowed"), {
              name: "MethodNotAllowed",
              allow: [...allowed]
            });
          }
          throw Object.assign(new Error("Not Found"), { name: "NotFound" });
        }
      });
    }

    return items.sort(compareItems);
  }

  protected async run(rawReq: http.IncomingMessage, res: http.ServerResponse) {
    const req = ensureTreeRequest(rawReq);
    const st = stateOf(req);
    st.root = this;
    st.res = res;

    const method = (req.method || "GET").toUpperCase();
    let path = getPathname(req.url);
    let items = this.resolveChain(path, method);
    let pos = 0;
    let last: ChainItem | undefined;

    debug(
      `running ${method} ${path}`,
      items.map((i) => `${i.kind}(${i.priority})`)
    );

    const take = () => {
      const p = getPathname(req.url);
      if (p !== path) {
        path = p;
        const l = last;
        items = this.resolveChain(p, method).filter(
          (i) => !l || compareItems(i, l) > 0
        );
        pos = 0;
      }
      const item = items[pos++];
      if (item) last = item;
      return item;
    };

    const rawSent = () => res.headersSent || res.writableEnded;
    const blocked = () => !!st.response || st.error !== undefined || rawSent();

    const accept = (value: unknown) => {
      const r = toTreeResponse(value);
      if (!r) return;
      if (rawSent()) {
        debug("response already sent");
        return;
      }
      st.response = r;
    };

    const fail = async (e: unknown, router: Router<any>) => {
      if (isTreeResponse(e)) return accept(e);

      st.error = e;
      if (rawSent()) {
        console.error("error after the response was already sent:", e);
        return;
      }
      st.response = await renderError(router, req as any, res, e);
    };

    const invoke = async (item: ChainItem): Promise<"auto" | "manual"> => {
      if (item.kind !== "middleware" && blocked()) {
        debug(`skipped ${item.kind} a response or error already exists`);
        return "auto";
      }

      let returned = false;
      let manual = false;
      let nextPromise: Promise<void> | undefined;
      let signalCalled!: () => void;
      const called = new Promise<void>((r) => (signalCalled = r));

      const getNext: HttpTreeNext = () => {
        if (returned) {
          debug("getNext() was called after the handler returned");
          return async () => {};
        }
        manual = true;
        return (err?: Error) => {
          if (!nextPromise) {
            signalCalled();
            nextPromise = (async () => {
              if (err) await fail(err, item.router);
              await runChain();
            })();
          }
          return nextPromise;
        };
      };

      req.params = item.params;

      try {
        let allowed = true;
        for (const chk of item.prechecks ?? []) {
          if (!(await chk(req, res))) {
            allowed = false;
            break;
          }
        }

        if (allowed) accept(await item.fn(req, res, getNext));
        else accept(error.forbidden());
      } catch (e) {
        await fail(e, item.router);
      }

      returned = true;
      if (!manual) return "auto";

      if (!nextPromise) {
        if (blocked()) return "auto";

        await new Promise<void>((resolve) => {
          const done = () => {
            res.off("close", done);
            resolve();
          };
          res.once("close", done);
          called.then(done);
        });
      }

      if (nextPromise) await nextPromise;
      return "manual";
    };

    const runChain = async (): Promise<void> => {
      for (;;) {
        const item = take();
        if (!item) return;
        debug(
          `running ${item.kind} (priority ${item.priority}, idx ${item.idx})`
        );
        if ((await invoke(item)) === "manual") return;
      }
    };

    try {
      await runChain();

      if (rawSent() || res.destroyed) return;

      flushResponse(
        res,
        st.response ?? createResponse("", 204),
        method === "HEAD"
      );
    } catch (e) {
      console.error("httptree internal error:", e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      } else {
        res.destroy();
      }
    }
  }

  handle = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => this.root.run(req, res);

  handleWS = async (ws: WebSocket, rawReq: http.IncomingMessage) => {
    const req = ensureTreeRequest(rawReq);
    const pathname = getPathname(req.url);

    for (const r of this.wsRoutes) {
      const m = r.info.regex.exec(pathname);
      if (!m) continue;

      const params: Record<string, string> = {};
      r.info.params.forEach((p, i) => {
        if (m[i + 1]) {
          params[p] = decodeURIComponent(m[i + 1]!);
        }
      });

      req.params = params;

      for (const chk of r.prechecks) {
        const ok = await chk(req, {} as any);
        if (!ok) {
          ws.close(1008, "Forbidden");
          return;
        }
      }

      await r.handler(ws, req as any);
      return;
    }

    ws.close(1002, "No WS route");
  };

  protected add(
    method: string,
    path: string,
    handler: HttpTreeHandler<any>,
    priority = 0
  ) {
    const full = join(this.base, path);
    const info = compilePattern(full);
    debug(
      `Adding route: method='${method}', full path='${full}', regex='${info.regex}', params=[${info.params.join(", ")}]`
    );

    this.routes.push({
      method,
      info,
      handler,
      prechecks: [...this.inheritedChecks],
      path,
      priority,
      idx: this.nextIdx(),
      router: this
    });

    this.routes.sort(
      (a, b) =>
        b.info.score - a.info.score ||
        b.info.regex.source.length - a.info.regex.source.length ||
        Number(a.method === "*") - Number(b.method === "*")
    );

    return this;
  }
}

export class BaseRouter extends Router {
  #server?: import("http").Server;

  protected upgradeHandlers: Array<{
    fn: HttpTreeUpgradeHandler;
    priority: number;
    idx: number;
  }> = [];
  protected upgradeRegIdx = 0;

  handleError(type: string, handler: HttpTreeErrorHandler) {
    super.handleError(type as any, handler);
    return this;
  }

  /** configure global options */
  config(options: HttpTreeOptions) {
    if (options.body) {
      const next = { ...this.bodyConfig, ...options.body };
      for (const k of ["maxSize", "maxFileSize", "maxFieldSize"] as const) {
        const v = next[k];
        if (v !== undefined) parseSize(v, k);
      }
      this.bodyConfig = next;
    }
    return this;
  }

  listen(port: number, cb?: () => void): Promise<void> | import("http").Server {
    const server = http.createServer(
      { IncomingMessage: TreeRequest as any },
      (req, res) => {
        void this.handle(req, res);
      }
    );

    this.#server = server;

    const WSSCtor = getWebSocketServer();
    if (WSSCtor) {
      const wss = new WSSCtor({ noServer: true });

      this.useUpgrade((req, socket, head) => {
        // only accept websocket upgrades
        if (req.headers.upgrade !== "websocket") return false;

        wss.handleUpgrade(req, socket, head, (ws) => {
          this.handleWS(ws, req).catch((e) => {
            debug("websocket handler failed", e);
            ws.close(1011, "Internal Error");
          });
        });

        return true;
      });
    }

    server.on("upgrade", (req, socket, head) => {
      const list = [...this.upgradeHandlers].sort(
        (a, b) => b.priority - a.priority || a.idx - b.idx
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

  useUpgrade(fn: HttpTreeUpgradeHandler, priority = 0) {
    this.upgradeHandlers.push({ fn, priority, idx: this.upgradeRegIdx++ });
  }
}

function normalize(p: string) {
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+/g, "/");
  if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function join(a: string, b: string) {
  if (a === "/") a = "";
  if (a !== "/" && a.endsWith("/")) a = a.slice(0, -1);
  b = b.replace(/^\/+/, "");
  if (!b) return a;
  return a + "/" + b;
}

/**
 * @example
 ```ts
   //no args (defaults)
   const tree = root()
   // with base path
   const tree = root("/api")
   // with base path and options
   const tree = root("/", { body: { maxSize: "2mb" } })
   // only options
   const tree = root({ body: { maxSize: "2mb" } })
   ```
 */
export function root(
  baseOrOptions: string | HttpTreeOptions = "/",
  options?: HttpTreeOptions
) {
  const base = typeof baseOrOptions === "string" ? baseOrOptions : "/";
  const opts = typeof baseOrOptions === "string" ? options : baseOrOptions;

  const tree = new BaseRouter(base);
  if (opts) tree.config(opts);
  return tree;
}
