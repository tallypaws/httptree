/**
 * cookie parsing, setting and getting for httptree
 *
 * `@tally.paws/httptree-ext-cookies`
 * 
 * ```ts
 * import { root, text } from "@tally.paws/httptree";
 * import { cookie, cookies, withCookies } from "@tally.paws/httptree-ext-cookies";
 *
 * const tree = root().extend(cookies);
 *
 * tree.get("/", (req) =>
 *   withCookies(text(req.getCookie("theme") ?? "light"), cookie("seen", "1", { maxAge: 3600 }))
 * );
 * ```
 * @packageDocumentation
 */

import {
  appendHeader,
  createResponse,
  defineExtension,
  perRequestLazy,
  toTreeResponse,
  type Extension,
  type TreeResponse
} from "@tally.paws/httptree";

/** options for {@link cookie} */
export interface CookieOptions {
  /** seconds until the cookie expires, `0` or less deletes it */
  maxAge?: number;
  /** when the cookie expires, browsers prefer `maxAge` if both are set */
  expires?: Date;
  /** also sent to subdomains, leave it out to keep it to the exact host */
  domain?: string;
  /**
   * where the cookie is sent
   * @default "/"
   */
  path?: string;
  /** hides the cookie from `document.cookie` */
  httpOnly?: boolean;
  /** only sent over https */
  secure?: boolean;
  /** `true` is the same as `"strict"`, `"none"` needs `secure` */
  sameSite?: boolean | "strict" | "lax" | "none";
  /** separate storage per top level site (CHIPS), needs `secure` */
  partitioned?: boolean;
  /** eviction priority hint, chrome only */
  priority?: "low" | "medium" | "high";
}

/** one cookie from the `Cookie` header */
export interface ParsedCookie {
  name: string;
  value: string;
}

/** what the {@link cookies} extension adds to every request */
export interface CookieRequest {
  /** every cookie the request sent, duplicates too, parsed once per request */
  getCookies(): ParsedCookie[];
  /**
   * the value of one cookie, `undefined` if it wasnt sent
   *
   * if the name was sent more than once you get the first, browsers put the most specific path first
   */
  getCookie(name: string): string | undefined;
  /**
   * adds cookies to whatever response ends up being sent
   * takes what {@link cookie} and {@link clearCookie} return or a raw `"name=value; Path=/"` string
   *
   * @example
   * ```ts
   * req.setCookie(cookie("sid", id, { httpOnly: true, sameSite: "lax" }));
   * ```
   */
  setCookie(...cookies: (string | string[])[]): void;
}

const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const attr = /^[\x20-\x3a\x3c-\x7e]*$/;

/** parses a `Cookie` header, bad pieces are skipped, quotes removed, values url-decoded if they can be */
export function parseCookies(header: string | undefined): ParsedCookie[] {
  const out: ParsedCookie[] = [];
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value[0] === '"' && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      value = decodeURIComponent(value);
    } catch {
    }
    out.push({ name, value });
  }
  return out;
}

/**
 * builds a `Set-Cookie` value
 *
 * @example
 * ```ts
 * cookie("sid", "abc", { httpOnly: true, sameSite: "lax", maxAge: 86400 });
 * // "sid=abc; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax"
 * ```
 *
 * @throws `TypeError` for a bad name or attribute, or things browsers reject (`SameSite=None` without `secure`, `__Host-` rules)
 */
export function cookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  if (!token.test(name)) {
    throw new TypeError(`httptree-ext-cookies: invalid cookie name "${name}"`);
  }
  const path = options.path ?? "/";
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge)) {
      throw new TypeError("httptree-ext-cookies: maxAge has to be a number");
    }
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  if (options.domain !== undefined) {
    if (!attr.test(options.domain)) {
      throw new TypeError("httptree-ext-cookies: invalid domain");
    }
    parts.push(`Domain=${options.domain}`);
  }
  if (!attr.test(path)) {
    throw new TypeError("httptree-ext-cookies: invalid path");
  }
  parts.push(`Path=${path}`);
  if (options.expires !== undefined) {
    if (Number.isNaN(options.expires.getTime())) {
      throw new TypeError("httptree-ext-cookies: invalid expires date");
    }
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  const sameSite =
    options.sameSite === true ? "strict" : options.sameSite || undefined;
  if (sameSite) {
    if (sameSite === "none" && !options.secure) {
      throw new TypeError('httptree-ext-cookies: sameSite "none" needs secure: true');
    }
    parts.push(`SameSite=${sameSite[0]!.toUpperCase()}${sameSite.slice(1)}`);
  }
  if (options.partitioned) {
    if (!options.secure) {
      throw new TypeError("httptree-ext-cookies: partitioned needs secure: true");
    }
    parts.push("Partitioned");
  }
  if (options.priority) {
    parts.push(
      `Priority=${options.priority[0]!.toUpperCase()}${options.priority.slice(1)}`
    );
  }
  if (name.startsWith("__Secure-") && !options.secure) {
    throw new TypeError("httptree-ext-cookies: __Secure- cookies need secure: true");
  }
  if (
    name.startsWith("__Host-") &&
    (!options.secure || path !== "/" || options.domain !== undefined)
  ) {
    throw new TypeError(
      'httptree-ext-cookies: __Host- cookies need secure: true, path "/" and no domain'
    );
  }
  return parts.join("; ");
}

/**
 * builds a `Set-Cookie` value that deletes a cookie
 * `path`, `domain` and the rest have to match what it was set with
 */
export function clearCookie(
  name: string,
  options: Pick<
    CookieOptions,
    "path" | "domain" | "secure" | "httpOnly" | "sameSite" | "partitioned"
  > = {}
): string {
  return cookie(name, "", { ...options, maxAge: 0, expires: new Date(0) });
}

function checkLines(list: string[]) {
  for (const c of list) {
    if (/[\r\n]/.test(c)) {
      throw new TypeError("httptree-ext-cookies: a cookie can not contain a line break");
    }
  }
}

/**
 * adds cookies to a response and returns a new one
 *
 * @example
 * ```ts
 * tree.post("/login", async () =>
 *   withCookies(json({ ok: true }), cookie("sid", sid, { httpOnly: true }), clearCookie("guest"))
 * );
 * ```
 *
 * @param response anything a handler can return, see {@link HandlerReturn}
 */
export function withCookies(
  response: unknown,
  ...cookies: (string | string[])[]
): TreeResponse {
  const base = toTreeResponse(response) ?? createResponse("", 204);
  const list = cookies.flat();
  checkLines(list);
  if (!list.length) return base;
  const headers = { ...base.headers };
  appendHeader(headers, "Set-Cookie", list);
  return { ...base, headers };
}

const jar = perRequestLazy<ParsedCookie[]>((req) => parseCookies(req.headers.cookie));
const queued = perRequestLazy<string[]>(() => []);

/**
 * cookie parsing and setting, see {@link CookieRequest}
 *
 * @example
 * ```ts
 * const tree = root().extend(cookies);
 *
 * tree.get("/", (req) =>
 *   withCookies(text(req.getCookie("theme") ?? "light"), cookie("seen", "1", { maxAge: 3600 }))
 * );
 * ```
 */
export const cookies: Extension<CookieRequest> = defineExtension<CookieRequest>({
  name: "cookies",
  request: {
    getCookies(): ParsedCookie[] {
      return jar.get(this);
    },
    getCookie(name: string): string | undefined {
      return jar.get(this).find((c) => c.name === name)?.value;
    },
    setCookie(...values: (string | string[])[]): void {
      const list = values.flat();
      checkLines(list);
      queued.get(this).push(...list);
    }
  },
  setup(root) {
    root.use((req) => {
      const list = queued.peek(req);
      if (!list?.length) return;
      req.response = withCookies(req.response, list);
    }, -1000);
  }
});
