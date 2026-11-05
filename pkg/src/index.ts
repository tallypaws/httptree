import * as http from "http";
import type { Duplex } from "stream";

// im gonna kill esm
// import { type WebSocket } from "ws";
type WebSocket = import("ws").WebSocket;

import { _require, debug, parseSize, type Flat } from "./util.js";
import type { Extension } from "./extension.js";
import {
  createResponse,
  error,
  flushResponse,
  flushUpgradeResponse,
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
  createResponse,
  isTreeResponse,
  toTreeResponse,
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
export {
  defineExtension,
  perRequest,
  perRequestLazy,
  type Extension
} from "./extension.js";
export {
  addVary,
  appendHeader,
  deleteHeader,
  getHeader,
  hasHeader,
  setHeader,
  type ResponseHeaders
} from "./headers.js";
export { validateSchema } from "./body.js";
export type { Flat } from "./util.js";
export type {
  BodyConfig,
  BufferOptions,
  FormOptions,
  InferOutput,
  JSONOptions,
  ParsedForm,
  Size,
  StandardIssue,
  StandardResult,
  StandardSchemaV1,
  TextOptions,
  UploadedFile
} from "./body.js";

let WebSocketServer: typeof import("ws").WebSocketServer | undefined;

function getWebSocketServerClass() {
  if (WebSocketServer) return WebSocketServer;
  try {
    const mod = _require("ws");
    WebSocketServer = mod.WebSocketServer;
    return WebSocketServer;
  } catch {
    return undefined;
  }
}

/** `D` with the keys of `T` replaced by `T`'s */
type Merge<D, T> = Flat<Omit<D, keyof T> & T>;

/** turns a route path string into its params object (`"/users/[id]"` into `{ id: string }`) with borderline magic*/
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

/**
 *  - `string` sent as text
 *  - `number`, `boolean`, objects and arrays sent as JSON
 *  - `Buffer` or `Uint8Array` sent as bytes
 *  - node streams, web `ReadableStream` and web `Response` get streamed
 *  - `json()` `html()` `redirect()` `error.*` etc when you need a status or headers
 *  - `undefined` or `null` sets nothing, if nothing else sets a response it ends up as an empty `204`
 *
 * Throwing a response (`throw error.notFound()`) works the same as returning it
 */
export type HandlerReturn =
  | object
  | string
  | number
  | boolean
  | null
  | undefined
  | void
  | Promise<object | string | number | boolean | null | undefined | void>;

/**
 * takes manual control of the chain, a function that returns the function you call to run the rest of it
 *
 * ```ts
 * const next = getNext(); // after this the chain waits for you
 * await next();           // runs everything after this one (handler, lower priority middleware)
 * // code here runs once the rest is done and a response exists
 * ```
 *
 * once you call `getNext()` you have to call the function it gives you
 * pass an error to `next(err)` to fail the request without running the rest
 *
 * > [!WARNING]
 * > if you never call it the request hangs until the connection closes
 * > call `getNext()` before the middleware callback resolves, or the function it returns is a no-op and may throw in the future
 */
export type HttpTreeNext = () => (err?: Error) => Promise<void>;

/**
 * middleware callback, see {@link RootRouter.use}
 *
 * return nothing to continue, or return a response to answer early (the route handler is skipped but other middleware still runs)
 */
export type HttpTreeMiddleware<
  P extends Record<string, any> = Record<string, string | string[]>,
  X extends object = {},
  D extends object = {}
> =
  /**
   * @param req the request, a node `IncomingMessage` plus `params`, `getJSON()`, `data` and more
   * @param res the raw node response, rarely used (anything written to it directly is sent as is and skips the response system)
   * @param getNext call it to wrap the rest of the chain, see {@link HttpTreeNext}
   */
  (
    req: HttpTreeRequest<P, X, D>,
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

/**
 * websocket middleware callback, see {@link Router.useWS}
 *
 * runs on the upgrade request before the handshake
 * return nothing to continue, or return (or throw) a response to reject the upgrade with it
 */
export type HttpTreeWSMiddleware<
  P extends Record<string, any> = Record<string, string | string[]>,
  X extends object = {},
  D extends object = {}
> =
  /**
   * @param req the upgrade request with `params` and `data`, whatever you put in `data` is still there in the ws handler
   * @param socket the raw network socket, rarely used (the handshake has not happened yet so do not write to it)
   */
  (req: HttpTreeRequest<P, X, D>, socket: Duplex) => HandlerReturn;

/**
 * route handler callback, what you pass to `tree.get()` and similar
 *
 * return the response (see {@link HandlerReturn}) or throw one, async is accepted
 */
export type HttpTreeHandler<
  P extends Record<string, any>,
  X extends object = {},
  D extends object = {}
> =
  /**
   * @param req the request, a node `IncomingMessage` plus `params`, `getJSON()`, `getForm()`, `data` and more
   * @param res the raw node response, rarely used (anything written to it directly is sent as is and skips the response system)
   * @param getNext call it to wrap the rest of the chain, almost never needed in a handler, see {@link HttpTreeNext}
   */
  (
    req: HttpTreeRequest<P, X, D>,
    res: http.ServerResponse,
    getNext: HttpTreeNext
  ) => HandlerReturn;

/**
 * error handler callback, see {@link RootRouter.handleError}
 *
 * the return value becomes the response, throwing inside it falls back to the default error response
 */
export type HttpTreeErrorHandler<X extends object = {}, D extends object = {}> =
  /**
   * @param err what was thrown (`NotFound` and `MethodNotAllowed` are errors with that `name`, 405 also has `err.allow`)
   */
  (
    err: any,
    req: HttpTreeRequest<Record<string, string | string[]>, X, D>,
    res: http.ServerResponse
  ) => HandlerReturn;

/**
 * websocket route callback, see {@link RootRouter.ws}
 */
export type HttpTreeWSHandler<
  P extends Record<string, any> = Record<string, any>,
  X extends object = {},
  D extends object = {}
> =
  /**
   * @param req the upgrade request with `params` and `data`
   */
  (ws: WebSocket, req: HttpTreeRequest<P, X, D>) => void | Promise<void>;

/**
 * raw `upgrade` event callback, see {@link RootRouter.useUpgrade}
 *
 * return `true` if you took the socket, anything else lets the next handler try
 */
export type HttpTreeUpgradeHandler =
  /**
   * @param head first packet of the upgraded stream
   */
  (req: http.IncomingMessage, socket: any, head: Buffer) => boolean | void;

/**
 * guard callback for a branch, see {@link RootRouter.branch}
 *
 *  - return `true` to let the request through
 *  - return a response to answer with it right away and skip the route handler
 *  - return `false` (or anything else, including nothing) to answer with a `403`
 *  - throwing a response does the same as returning it
 *
 * a branch can have several guards, they run in order (outermost branch first, then left to right)
 * the first one that does not return `true` answers the request
 * an earlier guard can put things in `req.data` for the later ones
 *
 * for websocket routes, anything but `true` closes the socket with `1008`
 * this happens after the handshake, to reject before it use {@link Router.useWS}
 */
export interface HttpTreePrecheck<
  X extends object = {},
  D extends object = {}
> {
  /**
   * @param res the raw node response, for websocket routes this is an empty object so do not use it
   */
  (
    req: HttpTreeRequest<Record<string, string | string[]>, X, D>,
    res: http.ServerResponse
  ): boolean | TreeResponse | Promise<boolean | TreeResponse>;
}
/** a registered http route, what {@link RootRouter.get} and the others store */
export type HttpTreeRoute = {
  /** http method in uppercase, `"*"` for {@link RootRouter.all} */
  method: string;
  info: PatternInfo;
  handler: HttpTreeHandler<any, any, any>;
  /** guards of every branch above the route, run in order before the handler */
  prechecks: HttpTreePrecheck<any, any>[];
  /** path as it was registered, relative to `router` */
  path: string;
  /** position in the chain, middleware is above `0` by default */
  priority: number;
  /** registration order, tiebreaker for matching priorities*/
  idx: number;
  /** router the route was registered on */
  router: Router<any, any, any>;
};

/** a registered middleware */
export type HttpTreeMiddlewareEntry = {
  fn: HttpTreeMiddleware<any, any, any>;
  priority: number;
  /** registration order, breaks priority ties */
  idx: number;
  /** only requests matching this run it, `undefined` means every request*/
  scope?: PatternInfo;
  /** router the middleware was registered on */
  router: Router<any, any, any>;
};

/** a registered websocket middleware */
export type HttpTreeWSMiddlewareEntry = {
  fn: HttpTreeWSMiddleware<any, any, any>;
  priority: number;
  /** registration order, breaks priority ties */
  idx: number;
  /** only requests matching this run it, `undefined` means every request */
  scope?: PatternInfo;
  /** router the middleware was registered on */
  router: Router<any, any, any>;
};

/** a registered websocket route */
export type HttpTreeWSRoute = {
  info: PatternInfo;
  handler: HttpTreeWSHandler<any, any, any>;
  /** guards of every branch above the route, a failed one closes the socket with `1008` */
  prechecks: HttpTreePrecheck<any, any>[];
  /** path as it was registered, relative to `router` */
  path: string;
  /** router the route was registered on */
  router: Router<any, any, any>;
};

/** global options, see {@link root} and {@link RootRouter.config} */
export interface HttpTreeOptions {
  /** body size limits, see {@link BodyConfig} */
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
  router: Router<any, any, any>;
  params: RouteParams;
  prechecks?: HttpTreePrecheck<any, any>[];
};

const compareItems = (a: ChainItem, b: ChainItem) =>
  b.priority - a.priority || a.idx - b.idx;

function findErrorHandler(
  router: Router<any, any, any> | undefined,
  type: string
) {
  for (let r = router; r; r = r.parent) {
    const h = r.errorHandlers.get(type) ?? r.errorHandlers.get("*");
    if (h) return h;
  }
  return undefined;
}

async function renderError(
  router: Router<any, any, any>,
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

async function runPrechecks(
  checks: HttpTreePrecheck<any, any>[] | undefined,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<true | TreeResponse> {
  for (const chk of checks ?? []) {
    const out = await chk(req, res);
    if (out === true) continue;
    return isTreeResponse(out) ? out : error.forbidden();
  }
  return true;
}

/**
 * base class for every router, branches and the root
 */
export class Router<
  P extends Record<string, string> = {},
  X extends object = {},
  D extends object = {}
> {
  /**
   * @private
   */
  protected base: string;
  /**
   * @private
   */
  protected routes: HttpTreeRoute[];
  /**
   * @private
   */
  protected wsRoutes: HttpTreeWSRoute[];
  /**
   * @private
   */
  protected middlewares: HttpTreeMiddlewareEntry[];
  /**
   * @private
   */
  protected wsMiddlewares: HttpTreeWSMiddlewareEntry[];
  /**
   * @private
   */
  protected inheritedChecks: HttpTreePrecheck<any, any>[];
  /**
   * @private
   */
  protected root: Router<any, any, any>;
  /**
   * @private
   */
  protected seq = 0;
  /**
   * @private
   */
  protected branches: Router<any, any, any>[] = [];
  /**
   * @private
   */
  protected guarded = false;
  /** router this one was branched from, `undefined` on the root */
  public parent?: Router<any, any, any>;

  /**
   * the request class of this tree, a subclass of {@link TreeRequest} that extensions add stuff to, shared by every branch
   * @private
   */
  protected requestClass: typeof TreeRequest;

  /** body size limits, only the root's are used, set them with {@link RootRouter.config} */
  public bodyConfig: BodyConfig = {};

  /** error handlers registered on this router, see {@link Router.handleError} */
  public errorHandlers: Map<string, HttpTreeErrorHandler<any, any>>;

  /**
   * @protected // not actually protected but you should not use this
   * use {@link root} or {@link Router.branch} instead
   */
  constructor(
    base = "/",
    root?: Router<any, any, any>,
    inheritedChecks: HttpTreePrecheck<any, any>[] = []
  ) {
    this.base = normalize(base);
    this.root = root ?? this;
    this.routes = root ? root.routes : [];
    this.wsRoutes = root ? root.wsRoutes : [];
    this.middlewares = root ? root.middlewares : [];
    this.wsMiddlewares = root ? root.wsMiddlewares : [];
    this.inheritedChecks = inheritedChecks;
    this.errorHandlers = new Map();
    this.requestClass = root
      ? root.requestClass
      : (class extends TreeRequest {} as typeof TreeRequest);
  }
  /**
   * @private
   */
  protected nextIdx() {
    return this.root.seq++;
  }

  /**
   * registers an error handler for this router and everything below it
   *
   *  - `NotFound` no route matched
   *  - `MethodNotAllowed` the path matched but not for this method (`err.allow` lists the methods that do)
   *  - `InternalError` anything else that was thrown
   *  - `*` any of the above
   *
   * return nothing to get the default error response
   * throwing a response (`throw error.notFound()`) skips error handlers entirely
   *
   * `NotFound` and `MethodNotAllowed` are only looked up on the root, nothing has matched yet so no branch is involved
   *
   * @example
   * ```ts
   * tree.handleError("NotFound", (err, req) =>
   *   json({ error: "not found", path: req.url }, { status: 404 })
   * );
   *
   * // only for errors thrown by routes and middleware under /api
   * const api = tree.branch("/api");
   * api.handleError("InternalError", () =>
   *   json({ error: "something broke" }, { status: 500 })
   * );
   * ```
   *
   * @param type which error to handle
   * @returns this router, for chaining
   */
  handleError(
    type: "NotFound" | "MethodNotAllowed" | "InternalError" | "*",
    handler: HttpTreeErrorHandler<X, D>
  ) {
    debug(
      `Registering error handler for type '${type}' on base '${this.base}'`
    );
    this.errorHandlers.set(type, handler);
    return this;
  }

  /**
   * creates a branch
   *
   * everything registered on the branch lives under its path and params in the path are typed on `req.params`
   * the guards run right before the route handler of every route in the branch (child branches included), see {@link HttpTreePrecheck}
   * pass as many as you want, they run in order (parent branch guards first, then these left to right)
   * the first one that does not return `true` answers the request
   * middleware registered on the branch only runs for requests under its path, see {@link Router.use}
   *
   * @example
   * ```ts
   * const api = tree.branch("/api", (req) => !!req.headers.authorization);
   * api.get("/me", () => "hi");
   *
   * // more than one guard, runs left to right
   * const admin = tree.branch("/admin", isAuthed, isAdmin);
   *
   * // params in a branch path are typed in everything under it
   * const org = api.branch("/orgs/[org]");
   * org.get("/members/[id]", (req) => json({ org: req.params.org, id: req.params.id }));
   * ```
   *
   * @param path relative to this router
   */
  branch<Path extends string>(
    path: Path,
    ...guards: HttpTreePrecheck<X, D>[]
  ): Router<P & Params<Path>, X, D> {
    let full = join(this.base, path as string);
    debug(
      `branch: parent base='${this.base}', requested path='${path}', full before normalization='${full}'`
    );
    const normalizedFull = normalize(full);
    debug(`normalized full path for branch: '${normalizedFull}'`);
    const checks = [...this.inheritedChecks, ...guards];
    const branch = new Router<P & Params<Path>, X, D>(
      normalizedFull,
      this.root,
      checks
    );
    branch.parent = this;
    branch.guarded = guards.length > 0;
    this.branches.push(branch);
    debug(`branch with base '${branch.base}' under parent base '${this.base}'`);
    return branch;
  }

  /**
   * registers a middleware callback
   *
   *  - higher priority runs first, then registered first runs first
   *  - route handlers have a priority of 0
   *  - negative priorities run after handlers
   *
   * does not run for websocket routes, see {@link Router.useWS}
   *
   * @example
   * ```ts
   * // runs before every handler
   * tree.use((req) => {
   *   req.data.start = Date.now();
   * });
   *
   * // runs first (higher priority)
   * tree.use(() => console.log("first"), 10);
   *
   * // runs after the handler (negative priority)
   * tree.use((req) => {
   *   if (req.isError()) return;
   *   req.response!.headers["X-Took"] = `${Date.now() - req.data.start}ms`;
   * }, -1);
   * ```
   *
   * @example
   * ```ts
   * // scoped to a branch
   * const admin = tree.branch("/admin");
   *
   * admin.use((req) => {
   *   if (!req.headers.authorization) throw error.unauthorized();
   * });
   * ```
   *
   * @example
   * ```ts
   * // wrap the rest of the chain with getNext
   * tree.use(async (req, res, getNext) => {
   *  // take over control of the chain
   *  // usually not needed, async middleware is already awaited before the next one starts
   *  // only for async IIFEs that are not awaited (eg. callback chains)
   *   const next = getNext();
   *   console.log("before");
   *   await next(); // run everything else
   *   console.log("after");
   * });
   *
   *
   * ```
   *
   * @param priority where this middleware sits in the chain
   * @returns this router, for chaining
   */
  use(fn: HttpTreeMiddleware<Flat<P>, X, D>, priority = 1) {
    debug(`Registering middleware on '${this.base}' with priority=${priority}`);
    this.middlewares.push({
      fn: fn as HttpTreeMiddleware<any, any, any>,
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

  /**
   * adds typed values to `req.data`
   *
   * `fn` runs for every request under this router like middleware, what it returns gets merged into `req.data`
   * the type follows, register routes on what `derive` returns (or the branch you called it on)
   *
   * > [!NOTE]
   * > it runs for requests that end up as a `404` too, like all middleware
   *
   * @example
   * ```ts
   * const api = tree.branch("/api").derive(async (req) => ({
   *   user: await getUser(req.headers.authorization)
   * }));
   *
   * api.get("/me", (req) => json(req.data.user)); // typed
   * ```
   *
   * @param priority where this sits in the chain, same as {@link Router.use}
   * @returns this router, typed with the new `req.data`
   */
  derive<T extends object>(
    fn: (req: HttpTreeRequest<Flat<P>, X, D>) => T | Promise<T>,
    priority = 1
  ): Router<P, X, Merge<D, T>> {
    this.use(async (req) => {
      Object.assign(req.data, await fn(req as any));
    }, priority);
    return this as any;
  }

  /**
   * registers a middleware for websocket routes
   *
   * runs on the upgrade request before the handshake, so rejecting gives the client a real http response (`401` and so on) instead of a socket close
   * return nothing to continue, or return (or throw) a response to reject the upgrade
   *
   *  - higher priority runs first, then registered first runs first
   *  - there is no response phase so priority only sets the order
   *  - scoped to the branch it is registered on, like {@link Router.use}
   *  - `req.data` is shared with the ws handler and the branch guards
   *
   * > [!NOTE]
   * > branch guards still run after the handshake, only this runs before it
   *
   * @example
   * ```ts
   * tree.useWS(async (req) => {
   *   const user = await getUser(req.headers.cookie);
   *   if (!user) throw error.unauthorized("log in first");
   *   req.data.user = user;
   * });
   *
   * tree.ws("/chat", (ws, req) => {
   *   ws.send(`hi ${req.data.user.name}`);
   * });
   * ```
   *
   * @param priority where this middleware sits in the order
   * @returns this router, for chaining
   */
  useWS(fn: HttpTreeWSMiddleware<Flat<P>, X, D>, priority = 1) {
    debug(
      `Registering ws middleware on '${this.base}' with priority=${priority}`
    );
    this.wsMiddlewares.push({
      fn: fn as HttpTreeWSMiddleware<any, any, any>,
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

  /**
   * registers a `GET` route
   *
   * @example
   * ```ts
   * tree.get("/", () => text("hello"));
   * tree.get("/hi", () => "hi");
   *
   * // typed params
   * tree.get("/users/[id]", (req) => json({ id: req.params.id }));
   *
   * // optional and rest params
   * tree.get("/posts/[[page]]", (req) => json({ page: req.params.page ?? "1" }));
   * tree.get("/files/[...path]", (req) => json({ segments: req.params.path }));
   * ```
   *
   * @param [priority] position in the chain (default 0), leave it alone unless you know what you're doing
   * @returns this router, for chaining
   */

  get<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>, X, D>,
    priority = 0
  ) {
    debug(`Registering GET route: base='${this.base}', path='${path}'`);
    return this.add("GET", path, h, priority);
  }

  /**
   * registers a `POST` route
   *
   * read the request body with `req.getJSON()`, `req.getText()` or `req.getForm()`
   * dont trust a parsed body, the type you pass is not validated
   *
   * @example
   * ```ts
   * tree.post("/echo", async (req) => {
   *   const body = await req.getJSON<{ message: string }>();
   *   return json({ msg: body.message }, { status: 201 });
   * });
   * ```
   *
   * @param [priority] position in the chain (default 0), leave it alone unless you know what you're doing
   * @returns this router, for chaining
   */
  post<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>, X, D>,
    priority = 0
  ) {
    debug(`Registering POST route: base='${this.base}', path='${path}'`);
    return this.add("POST", path, h, priority);
  }

  /**
   * registers a `PATCH` route
   *
   * @example
   * ```ts
   * tree.patch("/users/[id]", async (req) => {
   *   const changes = await req.getJSON<{ name?: string }>();
   *   return json({ id: req.params.id, ...changes });
   * });
   * ```
   *
   * @param [priority] position in the chain (default 0), leave it alone unless you know what you're doing
   * @returns this router, for chaining
   */
  patch<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>, X, D>,
    priority = 0
  ) {
    debug(`Registering PATCH route: base='${this.base}', path='${path}'`);
    return this.add("PATCH", path, h, priority);
  }

  /**
   * registers a `PUT` route
   *
   * @example
   * ```ts
   * tree.put("/users/[id]", async (req) => {
   *   const user = await req.getJSON<{ name: string }>();
   *   return json({ id: req.params.id, ...user });
   * });
   * ```
   *
   * @param [priority] position in the chain (default 0), leave it alone unless you know what you're doing
   * @returns this router, for chaining
   */
  put<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>, X, D>,
    priority = 0
  ) {
    debug(`Registering PUT route: base='${this.base}', path='${path}'`);
    return this.add("PUT", path, h, priority);
  }

  /**
   * registers a `DELETE` route
   *
   * returning nothing sends an empty `204 No Content`
   *
   * @example
   * ```ts
   * tree.delete("/users/[id]", (req) => {
   *   db.users.remove(req.params.id);
   *   // no return: responds 204
   * });
   * ```
   *
   * @param [priority] position in the chain (default 0), leave it alone unless you know what you're doing
   * @returns this router, for chaining
   */
  delete<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>, X, D>,
    priority = 0
  ) {
    debug(`Registering DELETE route: base='${this.base}', path='${path}'`);
    return this.add("DELETE", path, h, priority);
  }

  /**
   * registers a route that matches every http method, including `HEAD` and `OPTIONS`
   *
   * @example
   * ```ts
   * tree.all("/health", (req) => json({ method: req.method }));
   *
   * // a specific method takes priority over `all` on the same path
   * tree.get("/items", () => json(items));
   * tree.all("/items", () => error.methodNotAllowed()); // already the default behavior
   * ```
   *
   * @param [priority] position in the chain (default 0), leave it alone unless you know what you're doing
   * @returns this router, for chaining
   */
  all<Path extends string>(
    path: Path,
    h: HttpTreeHandler<Flat<P & Params<Path>>, X, D>,
    priority = 0
  ) {
    debug(`Registering ALL route: base='${this.base}', path='${path}'`);
    return this.add("*", path as string, h, priority);
  }

  /**
   * registers a websocket route, needs the `ws` npm package
   *
   * guards from the branch apply and a failed one closes the socket with `1008`
   * a path without a websocket route closes the socket with `1002`
   *
   * > [!NOTE]
   * > middleware from {@link Router.use} does not run for websocket routes, use {@link Router.useWS}
   *
   * @example
   * ```ts
   * tree.ws("/chat/[room]", (ws, req) => {
   *   ws.send(`welcome to ${req.params.room}`);
   *   ws.on("message", (msg) => ws.send(`echo: ${msg}`));
   * });
   *
   * // guarded
   * const admin = tree.branch("/admin", (req) => !!req.headers.authorization);
   * admin.ws("/live", (ws) => ws.send("connected"));
   * ```
   *
   * @returns this router, for chaining
   * @throws if the `ws` package is not installed
   */
  ws<Path extends string>(
    path: Path,
    h: HttpTreeWSHandler<Flat<P & Params<Path>>, X, D>
  ) {
    debug(`Registering WS route: base='${this.base}', path='${path}'`);
    const WSSClass = getWebSocketServerClass();
    if (!WSSClass) {
      throw new Error(
        "httptree: WebSocket support requires the 'ws' package. Install it first."
      );
    }
    const full = join(this.base, path as string);
    const info = compilePattern(full);

    this.wsRoutes.push({
      info,
      handler: h as HttpTreeWSHandler<any, any, any>,
      prechecks: [...this.inheritedChecks],
      path: path as string,
      router: this
    });

    this.wsRoutes.sort((a, b) => b.info.score - a.info.score);

    return this;
  }

  /**
   * prints this router as a tree
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

    for (const m of this.wsMiddlewares) {
      if (m.router !== this) continue;
      const name = m.fn.name ? ` ${m.fn.name}` : "";
      leaves.push({
        idx: m.idx,
        text: `useWS${name} (priority ${m.priority})`
      });
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

    const nodes: { text: string; branch?: Router<any, any, any> }[] = leaves;

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
  /**
   * @private
   */
  protected resolveChain(pathname: string, method: string): ChainItem[] {
    let route: HttpTreeRoute | undefined;
    let routeParams: RouteParams | undefined;
    let malformed = false;
    const allowed = new Set<string>();

    // HEAD is answered by the GET route when there is no route made for HEAD (node drops the body)
    for (const want of method === "HEAD" ? ["HEAD", "GET"] : [method]) {
      for (const r of this.routes) {
        const m = r.info.regex.exec(pathname);
        if (!m) continue;

        if (r.method !== "*" && r.method !== want) {
          allowed.add(r.method);
          if (r.method === "GET") allowed.add("HEAD");
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
      if (route || malformed) break;
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
  /**
   * @private
   */
  protected async run(rawReq: http.IncomingMessage, res: http.ServerResponse) {
    const req = ensureTreeRequest(rawReq, this.root.requestClass.prototype);
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

    const fail = async (e: unknown, router: Router<any, any, any>) => {
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
          // not sure if this should throw
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
        const verdict = await runPrechecks(item.prechecks, req, res);

        if (verdict === true) accept(await item.fn(req, res, getNext));
        else accept(verdict);
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

  /**
   * request listener for a node http server
   *
   * dont use this unless you know what you are doing, use {@link RootRouter.listen} instead
   *
   * @example
   * ```ts
   * import * as http from "http";
   *
   * http.createServer(tree.handle).listen(3000);
   * ```
   */
  handle = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => this.root.run(req, res);

  /**
   * runs the {@link Router.useWS} middleware on an upgrade request, call it before the handshake
   * resolves `true` if the upgrade can go on, `false` if it was rejected (the response is already written to the socket)
   *
   * {@link RootRouter.listen} does this for you, you only need it with your own server
   *
   * @example
   * ```ts
   * server.on("upgrade", async (req, socket, head) => {
   *   if (!(await tree.runWSMiddleware(req, socket))) return;
   *   wss.handleUpgrade(req, socket, head, (ws) => tree.handleWS(ws, req));
   * });
   * ```
   */
  runWSMiddleware = async (
    rawReq: http.IncomingMessage,
    socket: Duplex
  ): Promise<boolean> => {
    const req = ensureTreeRequest(rawReq, this.root.requestClass.prototype);
    const pathname = getPathname(req.url);

    let routeParams: RouteParams | undefined;
    for (const r of this.wsRoutes) {
      const m = r.info.regex.exec(pathname);
      if (!m) continue;
      try {
        routeParams = extractParams(r.info, m);
      } catch {}
      break;
    }

    const list = [...this.wsMiddlewares].sort(
      (a, b) => b.priority - a.priority || a.idx - b.idx
    );

    for (const mw of list) {
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

      req.params = params;

      let rejection: TreeResponse | undefined;
      try {
        rejection = toTreeResponse(await mw.fn(req as any, socket));
      } catch (e) {
        if (isTreeResponse(e)) {
          rejection = e;
        } else {
          console.error("Error in ws middleware:", e);
          rejection = error.internalServerError();
        }
      }

      if (rejection) {
        flushUpgradeResponse(socket, rejection);
        return false;
      }
    }

    return true;
  };

  /**
   * hands an upgraded socket to the matching websocket route
   * closes the socket with `1008` if a guard says no and with `1002` if no route matches
   *
   * does not run the {@link Router.useWS} middleware, see {@link Router.runWSMiddleware}
   *
   * @example
   * ```ts
   * const wss = new WebSocketServer({ noServer: true });
   *
   * server.on("upgrade", (req, socket, head) => {
   *   wss.handleUpgrade(req, socket, head, (ws) => tree.handleWS(ws, req));
   * });
   * ```
   *
   * @param rawReq the upgrade request
   */
  handleWS = async (ws: WebSocket, rawReq: http.IncomingMessage) => {
    const req = ensureTreeRequest(rawReq, this.root.requestClass.prototype);
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

      let verdict: true | TreeResponse;
      try {
        verdict = await runPrechecks(r.prechecks, req, {} as any);
      } catch (e) {
        if (!isTreeResponse(e)) throw e;
        verdict = e;
      }

      if (verdict !== true) {
        ws.close(1008, http.STATUS_CODES[verdict.status] ?? "Forbidden");
        return;
      }

      await r.handler(ws, req as any);
      return;
    }

    ws.close(1002, "No WS route");
  };

  /**
   * @private
   */
  protected add(
    method: string,
    path: string,
    handler: HttpTreeHandler<any, any, any>,
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

/**
 * the root router, created with {@link root}
 */
export class RootRouter<
  X extends object = {},
  D extends object = {}
> extends Router<{}, X, D> {
  #server?: import("http").Server;
  #extensions = new Map<string, Extension<any>>();
  /** registration counter right after the last `extend`, anything past it was registered by the user */
  #extendedAt = 0;

  /**
   * adds an extension, see {@link extensions!authoring.defineExtension | defineExtension}
   *
   * its `request` members get added to every request of this tree (typed), its `setup` can register middleware
   * returns the same tree with a new type, so chain it and use what comes back
   *
   * > [!WARNING]
   * > call it before registering anything (routes, middleware, branches), a tree that has some throws
   * > `tree.extend(x)` on its own doesnt change the type of `tree`, write `const tree = root().extend(x)`
   *
   * @example
   * ```ts
   * const tree = root()
   *   .extend(cookies)
   *   .extend(cors({ origin: "https://example.com" }));
   *
   * tree.get("/", (req) => text(req.getCookie("theme") ?? "no theme"));
   * ```
   *
   * @throws if its already added, needs one thats missing, adds a request member that already exists or the tree isnt empty
   */
  extend<A extends object>(ext: Extension<A>): RootRouter<X & A, D> {
    if (this.seq !== this.#extendedAt || this.branches.length) {
      throw new Error(
        `httptree: extend("${ext.name}") has to come before routes, middleware and branches`
      );
    }
    if (this.#extensions.has(ext.name)) {
      throw new Error(
        `httptree: the "${ext.name}" extension was already added`
      );
    }
    for (const need of ext.requires ?? []) {
      if (!this.#extensions.has(need)) {
        throw new Error(
          `httptree: the "${ext.name}" extension needs "${need}", extend with "${need}" first`
        );
      }
    }
    const proto = this.requestClass.prototype;
    const descriptors = Object.getOwnPropertyDescriptors(ext.request ?? {});
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key in proto) {
        throw new Error(
          `httptree: the "${ext.name}" extension adds "${String(key)}" to the request but it already exists`
        );
      }
    }
    Object.defineProperties(proto, descriptors);
    this.#extensions.set(ext.name, ext);
    ext.setup?.(this);
    this.#extendedAt = this.seq;
    return this as any;
  }

  /** `true` if an extension with this name was added with {@link RootRouter.extend} */
  hasExtension(name: string): boolean {
    return this.#extensions.has(name);
  }

  /**
   * adds typed values to `req.data` for the whole tree, see {@link Router.derive}
   */
  derive<T extends object>(
    fn: (req: HttpTreeRequest<{}, X, D>) => T | Promise<T>,
    priority = 1
  ): RootRouter<X, Merge<D, T>> {
    return super.derive(fn, priority) as any;
  }

  /**
   * @private
   */
  protected upgradeHandlers: Array<{
    fn: HttpTreeUpgradeHandler;
    priority: number;
    idx: number;
  }> = [];
  /**
   * @private
   */
  protected upgradeRegIdx = 0;

  /**
   * sets global options, calling it again patches the existing config
   *
   * sizes are bytes or strings like `"512kb"` and `"2mb"` (see {@link Size}), an invalid size throws `RangeError`
   * a single call can override these: `req.getJSON({ maxSize: "10mb" })`
   *
   * @example
   * ```ts
   * tree.config({ body: { maxSize: "2mb", maxFiles: 5 } });
   * ```
   *
   * @returns this router, for chaining
   */
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

  /**
   * starts the server on a port
   *
   * @example
   * ```ts
   * tree.listen(3000);
   * ```
   * ```ts
   * // callback
   * tree.listen(3000, () => {
   *  console.log("Server started!")
   * })
   * ```
   * ```ts
   * // async/await promise
   * await tree.listen(3000)
   * console.log("Server started!")
   * ```
   *
   * @param [cb] called once the server starts
   * @returns the server when a callback is given, otherwise a promise that resolves once it is listening
   */
  listen(port: number, cb?: () => void): Promise<void> | import("http").Server {
    const server = http.createServer(
      { IncomingMessage: this.requestClass as any },
      (req, res) => {
        void this.handle(req, res);
      }
    );

    this.#server = server;

    const WSSClass = getWebSocketServerClass();
    if (WSSClass) {
      const wss = new WSSClass({ noServer: true });

      this.useUpgrade((req, socket, head) => {
        // only accept websocket upgrades
        if (req.headers.upgrade !== "websocket") return false;

        this.runWSMiddleware(req, socket)
          .then((ok) => {
            if (!ok || socket.destroyed) return;

            wss.handleUpgrade(req, socket, head, (ws) => {
              this.handleWS(ws, req).catch((e) => {
                debug("websocket handler failed", e);
                ws.close(1011, "Internal Error");
              });
            });
          })
          .catch((e) => {
            debug("websocket upgrade failed", e);
            socket.destroy();
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

  /**
   * stops the server started by {@link RootRouter.listen}
   * stops accepting connections and resolves once the open ones have ended, does nothing if it was never started
   *
   * @example
   * ```ts
   * await tree.stop();
   * ```
   */
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

  /**
   * registers a raw `upgrade` handler
   *
   * @example
   * ```ts
   * tree.useUpgrade((req, socket, head) => {
   *   if (req.url !== "/custom") return false;
   *   // you own the socket from here
   *   return true;
   * }, 10);
   * ```
   *
   * @param [priority] position in the upgrade handler list (default 0)
   */
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
 * creates a root router
 *
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
 *
 * @param [base] base path for the whole tree
 */
export function root(base: string): RootRouter<{}, {}>;

/**
 * creates a root router
 *
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
 *
 * @param [base] base path for the whole tree
 * @param [options] see {@link HttpTreeOptions}
 */
export function root(
  base: string,
  options: HttpTreeOptions
): RootRouter<{}, {}>;

/**
 * creates a root router
 *
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
 *
 * @param [options] see {@link HttpTreeOptions}
 */
export function root(options: HttpTreeOptions): RootRouter<{}, {}>;

/**
 * creates a root router
 *
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
export function root(): RootRouter<{}, {}>;

/**
 * creates a root router
 *
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
 *
 * @param [baseOrOptions] base path for the whole tree, or the options
 * @param [options] when a base path is given
 */
export function root(
  baseOrOptions?: string | HttpTreeOptions,
  options?: HttpTreeOptions
): RootRouter<{}, {}> {
  const base = typeof baseOrOptions === "string" ? baseOrOptions : "/";

  const opts =
    typeof baseOrOptions === "object" && baseOrOptions !== null
      ? baseOrOptions
      : options;

  const tree = new RootRouter(base);
  if (opts) tree.config(opts);

  return tree;
}
}
