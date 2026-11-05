/**
 * for writing your own extension, `defineExtension` and the per request storage helpers
 *
 * @packageDocumentation
 */

import type { HttpTreeRequest as create } from "./request.js";
import type { RootRouter } from "./index.js";

/**
 * an extension
 * create one with {@link defineExtension} and add it with {@link RootRouter.extend}
 *
 * `Add` is the type of what the extension adds to every request
 */
export interface Extension<Add extends object = {}> {
  /** unique name, used for {@link RootRouter.hasExtension} and for `requires` */
  readonly name: string;
  /** names of extensions that have to be added first */
  readonly requires?: readonly string[];
  /** methods and getters installed on the request, see {@link defineExtension} */
  readonly request?: Add;
  /** runs once when the extension is added, register middleware here */
  readonly setup?: (root: RootRouter<any, any>) => void;
}

/**
 * describes an extension, see {@link RootRouter.extend}
 *
 * whatever you put in `request` ends up on every request of the tree, typed, `this` in the methods is the request
 *
 * > [!NOTE]
 * > the members are copied onto the request prototype when the extension is added, getters stay getters
 * > adding a member that already exists on the request throws
 *
 * > [!WARNING]
 * > give methods that use `this` an explicit return type, typescript cant infer it inside the object its typing
 * > `this` is a plain request, to use another extension's members annotate it (`getUser(this: HttpTreeRequest & CookieRequest)`) and list it in `requires`
 *
 * @example
 * ```ts
 * const timing = defineExtension({
 *   name: "timing",
 *   request: {
 *     elapsed(): number {
 *       return Date.now() - started(this);
 *     }
 *   },
 *   setup(root) {
 *     root.use((req) => void started(req), 100);
 *   }
 * });
 *
 * const tree = root().extend(timing);
 * tree.get("/", (req) => text(`${req.elapsed()}ms`));
 * ```
 */
export function defineExtension<Add extends object = {}>(def: {
  name: string;
  requires?: readonly string[];
  request?: Add & ThisType<create>;
  setup?(root: RootRouter<any, any>): void;
}): Extension<Add> {
  if (!def.name || typeof def.name !== "string") {
    throw new TypeError("httptree: an extension needs a name");
  }
  return Object.freeze({ ...def }) as Extension<Add>;
}

/**
 * keeps a value per request
 * this is where extensions can store stuff
 *
 * `init` runs the first time the request is seen and the result is cached, nothing is put on the request itself
 *
 * @example
 * ```ts
 * const jar = perRequest((req) => parseCookies(req.headers.cookie));
 *
 * jar(req);
 * jar(req); // was already parsed the first time, returns the cached value
 * ```
 */
export function perRequest<T>(
  init: (req: create) => T
): (req: object) => T {
  const cache = new WeakMap<object, T>();
  return (req) => {
    if (cache.has(req)) return cache.get(req)!;
    const value = init(req as create);
    cache.set(req, value);
    return value;
  };
}

/**
 * like {@link perRequest} but with `peek`, which reads without creating
 */
export function perRequestLazy<T>(init: (req: create) => T): {
  get(req: object): T;
  peek(req: object): T | undefined;
} {
  const cache = new WeakMap<object, T>();
  return {
    get(req) {
      if (cache.has(req)) return cache.get(req)!;
      const value = init(req as create);
      cache.set(req, value);
      return value;
    },
    peek: (req) => cache.get(req)
  };
}
