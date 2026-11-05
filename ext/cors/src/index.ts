/**
 * cors for httptree
 *
 * `@tally.paws/httptree-ext-cors`
 * 
 *
 * ```ts
 * import { root } from "@tally.paws/httptree";
 * import { cors } from "@tally.paws/httptree-ext-cors";
 *
 * const tree = root().extend(cors({ origin: "https://app.example.com", credentials: true }));
 * ```
 *
 * @packageDocumentation
 */

import {
  addVary,
  createResponse,
  defineExtension,
  setHeader,
  type Extension,
  type HttpTreeRequest,
  type ResponseHeaders
} from "@tally.paws/httptree";

type OriginMatcher = string | RegExp;

/** options for {@link cors} */
export interface CorsOptions {
  /**
   * which origins may call the api
   *
   *  - `"*"` anyone, the response says `*`
   *  - `true` anyone, the response repeats the request's origin (what you want with `credentials`)
   *  - a string or regex, or an array of them
   *  - a function that gets the origin and returns `true`, `false` or the exact origin to allow
   *
   * @default "*"
   */
  origin?:
    | "*"
    | boolean
    | OriginMatcher
    | OriginMatcher[]
    | ((
        origin: string,
        req: HttpTreeRequest
      ) => boolean | string | Promise<boolean | string>);
  /**
   * methods allowed in preflight
   * @default ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]
   */
  methods?: string[];
  /** request headers allowed in preflight, leave it out to allow whatever the browser asks for */
  allowedHeaders?: string[];
  /** response headers javascript on the page may read */
  exposedHeaders?: string[];
  /** allow cookies and auth headers, cant be used with `origin: "*"` */
  credentials?: boolean;
  /** seconds the browser may cache the preflight answer */
  maxAge?: number;
  /** answer `Access-Control-Request-Private-Network` preflights */
  privateNetwork?: boolean;
  /**
   * middleware priority
   * make sure this is above everything else
   * @default 1000
   */
  priority?: number;
}

const defaultMethods = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

function matches(m: OriginMatcher, origin: string) {
  return typeof m === "string" ? m === origin : m.test(origin);
}

/**
 * cors for the whole tree
 *
 * answers preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) with a `204`, adds the headers to every other response
 *
 * > [!WARNING]
 * > middleware registered after this still runs for a preflight and a response thrown there replaces the answer
 * > auth middleware that rejects requests without credentials has to skip it: `if (req.sentResponse()) return;`
 *
 * @example
 * ```ts
 * const tree = root().extend(cors({
 *   origin: ["https://app.example.com", /\.example\.com$/],
 *   credentials: true,
 *   maxAge: 600
 * }));
 * ```
 *
 * @throws `TypeError` for `credentials` with `origin: "*"`
 */
export function cors(options: CorsOptions = {}): Extension {
  const origin = options.origin ?? "*";
  const wildcard = origin === "*";
  if (wildcard && options.credentials) {
    throw new TypeError(
      'httptree-ext-cors: credentials can not be used with origin "*", use origin: true to allow any origin'
    );
  }
  const methods = (options.methods ?? defaultMethods).join(", ");

  async function resolve(value: string, req: HttpTreeRequest): Promise<string | false> {
    if (origin === "*") return "*";
    if (origin === true) return value;
    if (origin === false) return false;
    if (typeof origin === "function") {
      const out = await origin(value, req);
      return out === true ? value : out === false ? false : out;
    }
    const list = Array.isArray(origin) ? origin : [origin];
    return list.some((m) => matches(m, value)) ? value : false;
  }

  return defineExtension({
    name: "cors",
    setup(root) {
      root.use(async (req, _res, getNext) => {
        const requestOrigin = req.headers.origin;
        const allowed = requestOrigin ? await resolve(requestOrigin, req) : false;
        const headers: ResponseHeaders = {};
        if (allowed) {
          headers["Access-Control-Allow-Origin"] = allowed;
          if (options.credentials) headers["Access-Control-Allow-Credentials"] = "true";
        }
        if (!wildcard) addVary(headers, "Origin");

        const preflight =
          req.method === "OPTIONS" &&
          !!requestOrigin &&
          req.headers["access-control-request-method"] !== undefined;

        if (preflight) {
          if (allowed) {
            headers["Access-Control-Allow-Methods"] = methods;
            if (options.allowedHeaders) {
              headers["Access-Control-Allow-Headers"] = options.allowedHeaders.join(", ");
            } else {
              const asked = req.headers["access-control-request-headers"];
              if (asked) {
                headers["Access-Control-Allow-Headers"] = asked;
                addVary(headers, "Access-Control-Request-Headers");
              }
            }
            if (options.maxAge !== undefined) {
              headers["Access-Control-Max-Age"] = String(Math.trunc(options.maxAge));
            }
            if (
              options.privateNetwork &&
              req.headers["access-control-request-private-network"] === "true"
            ) {
              headers["Access-Control-Allow-Private-Network"] = "true";
            }
          }
          return createResponse("", 204, headers);
        }

        if (allowed && options.exposedHeaders?.length) {
          headers["Access-Control-Expose-Headers"] = options.exposedHeaders.join(", ");
        }
        const next = getNext();
        await next();
        const response = req.response;
        if (response) {
          for (const [k, v] of Object.entries(headers)) {
            if (k.toLowerCase() === "vary") {
              for (const field of String(v).split(",")) addVary(response.headers, field.trim());
            } else {
              setHeader(response.headers, k, v);
            }
          }
        }
      }, options.priority ?? 1000);
    }
  });
}
