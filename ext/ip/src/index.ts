/**
 * get client ips with `req.getIp()` when behind a reverse proxy or a tunnel like cloudflared
 *
 * `@tally.paws/httptree-ext-ip`
 *
 *
 * ```ts
 * import { root } from "@tally.paws/httptree";
 * import { ip } from "@tally.paws/httptree-ext-ip";
 *
 * // cloudflared running next to your server
 * const tree = root().extend(ip({ trust: "cloudflared" }));
 *
 * tree.get("/", (req) => `hi ${req.getIp()}`);
 * ```
 *
 * nothing is trusted unless you say so
 *
 *  - without `trust`, `req.getIp()` is just the address that connected, all ip related headers are ignored
 *  - a rule is a header plus who's allowed to send it, the header is only read if the connecting address is one of those
 *  - headers you didnt list are never read, so a proxy that forgets to strip one cant forward a fake ip
 *  - if a rule doesnt work out the next one is tried, and if none do you get the address that connected
 *
 *  `req.getIpInfo()` shows rule status per request, `skipped` tells you why each rule didnt answer
 *
 * ## built in proxies
 *
 * | name          | header             | accepted from         |
 * | ------------- | ------------------ | --------------------- |
 * | `cloudflared` | `CF-Connecting-IP` | loopback, unix socket |
 * | `cloudflare`  | `CF-Connecting-IP` | cloudflare's ranges   |
 * | `nginx`       | `X-Forwarded-For`  | loopback, unix socket |
 * | `caddy`       | `X-Forwarded-For`  | loopback, unix socket |
 * | `traefik`     | `X-Forwarded-For`  | loopback, unix socket |
 * | `haproxy`     | `X-Forwarded-For`  | loopback, unix socket |
 * | `apache`      | `X-Forwarded-For`  | loopback, unix socket |
 * | `envoy`       | `X-Forwarded-For`  | loopback, unix socket |
 * | `ngrok`       | `X-Forwarded-For`  | loopback, unix socket |
 * | `fly`         | `Fly-Client-IP`    | private ranges        |
 * | `heroku`      | `X-Forwarded-For`  | private ranges        |
 * | `aws-alb`     | `X-Forwarded-For`  | private ranges        |
 *
 * ## tunnels
 *
 * with a tunnel, the connection comes from the tunnel itself and not from cloudflare, so the `cloudflare` ranges wont match, use `cloudflared` instead
 *
 * cloudflared on the same machine works, in docker it connects from a different address so you have to tell it who to trust
 *
 * ```ts
 * ip({ trust: { proxy: "cloudflared", peers: "private" } });
 * // or only one network
 * ip({ trust: { proxy: "cloudflared", peers: "172.18.0.0/16" } });
 * ```
 *
 * `peers` takes `"loopback"`, `"linklocal"`, `"private"`, `"cloudflare"`, `"unix"`, an ip, a cidr, a function, or a list of those, see {@link PeerMatcher}
 *
 * ## custom setups
 *
 * ```ts
 * ip({
 *   trust: [
 *     // a header your proxy always overwrites, plus a secret only it knows
 *     {
 *       header: "x-client-ip",
 *       peers: "10.0.0.0/8",
 *       verify: (req) => req.headers["x-proxy-secret"] === process.env.PROXY_SECRET
 *     },
 *     // a chain, the last 2 entries are your own proxies
 *     { header: "x-forwarded-for", format: "list", peers: "private", hops: 2 },
 *     // or skip every entry that's one of your proxies
 *     { header: "x-forwarded-for", format: "list", peers: "private", skip: ["private", "cloudflare"] }
 *   ]
 * });
 * ```
 *
 * `format` is `"single"` (one ip), `"list"` (a chain like `X-Forwarded-For`) or `"forwarded"` (the standard `Forwarded` header), see {@link ProxyRule}
 *
 * if a header has fewer entries than `hops` it gets ignored, since that means a proxy that should have added one didnt, or a proxy was bypassed
 *
 * ## remove
 *
 * ```ts
 * ip({ trust: "nginx", remove: true });
 * ```
 *
 * once the ip is resolved, this deletes the client ip headers from `req.headers`
 *
 * @packageDocumentation
 */

import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import {
  defineExtension,
  perRequestLazy,
  type Extension
} from "@tally.paws/httptree";

/**
 * what the connecting address can be matched against
 *
 *  - `"loopback"`, `"linklocal"`, `"private"` and `"cloudflare"` are built in ranges, see {@link ranges}
 *  - `"unix"` matches when the proxy connects over a unix socket (there's no address in that case)
 *  - `"any"` matches everything
 *  - an ip (`"10.0.0.5"`) or a cidr (`"10.0.0.0/8"`)
 *  - a function that gets the address and returns true or false
 *
 * > [!WARNING]
 * > with `"any"` every client can send the header, only use it if the server cant be reached except through the proxy
 */
export type PeerMatcher =
  | "loopback"
  | "linklocal"
  | "private"
  | "cloudflare"
  | "unix"
  | "any"
  | (string & {})
  | ((ip: string) => boolean);

/**
 * what the header looks like
 *
 *  - `"single"` exactly one ip, like `CF-Connecting-IP` or `X-Real-IP`
 *  - `"list"` a comma separated chain like `X-Forwarded-For`, read from the right
 *  - `"forwarded"` the standard `Forwarded` header (`for=` entries), read from the right
 */
export type HeaderFormat = "single" | "list" | "forwarded";

/**
 * one header you trust and who's allowed to send it
 *
 * the header is only read when the connecting address matches `peers`
 */
export interface ProxyRule {
  /** the header this rule reads, caseinsensitive */
  header: string;
  /**
   * what the header looks like
   * @default "single"
   */
  format?: HeaderFormat;
  /** who's allowed to send the header, checked against the address that connected to the server */
  peers: PeerMatcher | PeerMatcher[];
  /**
   * lists only, how many entries to ignore from the right, those are the proxies between you and the client
   *
   * a header with fewer entries than this is ignored, since a proxy that should have added one didnt
   */
  hops?: number;
  /** lists only, after `hops` keep skipping entries that match, the first one that doesnt is the client */
  skip?: PeerMatcher | PeerMatcher[];
  /** one last check, like a secret header only your proxy knows, return `false` to ignore this rule for the request */
  verify?: (req: IncomingMessage) => boolean;
  /** shows up in {@link IpInfo.rule} */
  name?: string;
}

const local: PeerMatcher[] = ["loopback", "unix"];
const forwardedFor = (peers: PeerMatcher | PeerMatcher[]) =>
  ({ header: "x-forwarded-for", format: "list", peers }) as const;

/**
 * the proxies and tunnels httptree already knows how to read, pick the ones you actually use with {@link IpOptions.trust}
 *
 * > [!NOTE]
 * > self hosted ones only accept the header from the same machine (loopback or a unix socket)
 * > if the proxy is in docker or on another machine you have to say who to trust, like `{ proxy: "nginx", peers: "private" }`
 */
export const proxies = {
  /**
   * cloudflare in front of your server (orange cloud), only cloudflare's own ranges can send the header
   *
   * not for tunnels, use `cloudflared` for those
   */
  cloudflare: {
    header: "cf-connecting-ip",
    format: "single",
    peers: "cloudflare"
  },
  /**
   * a cloudflare tunnel
   *
   * cloudflared connects to your server locally, so the peer is the tunnel and not cloudflare
   * on the same machine that's loopback, in docker it's the docker network (`peers: "private"`)
   */
  cloudflared: { header: "cf-connecting-ip", format: "single", peers: local },
  /** nginx on the same machine, works with `$proxy_add_x_forwarded_for` and with `$remote_addr` */
  nginx: forwardedFor(local),
  /** caddy on the same machine */
  caddy: forwardedFor(local),
  /** traefik on the same machine */
  traefik: forwardedFor(local),
  /** haproxy on the same machine, needs `option forwardfor` */
  haproxy: forwardedFor(local),
  /** apache (`mod_proxy`) on the same machine */
  apache: forwardedFor(local),
  /** envoy on the same machine, more than one envoy in a row needs `hops` */
  envoy: forwardedFor(local),
  /** the ngrok agent running on the same machine */
  ngrok: forwardedFor(local),
  /** fly.io, only reachable through their proxy, the client ip is in `Fly-Client-IP` */
  fly: { header: "fly-client-ip", format: "single", peers: "private" },
  /** heroku, the router adds the client to the end of `X-Forwarded-For` */
  heroku: forwardedFor("private"),
  /** an aws application load balancer, behind cloudfront it needs `hops: 1` */
  "aws-alb": forwardedFor("private")
} satisfies Record<string, ProxyRule>;

/** the names of the built in {@link proxies} */
export type ProxyName = keyof typeof proxies;

/** a built in proxy with some settings changed */
export type ProxyOverride = Partial<ProxyRule> & { proxy: ProxyName };

/** a built in proxy by name, one with changes, or a full custom {@link ProxyRule} */
export type TrustEntry = ProxyName | ProxyOverride | ProxyRule;

/** options for {@link ip} */
export interface IpOptions {
  /**
   * the proxies and tunnels in front of your server
   *
   * a rule's header is only read when the connecting address is allowed to send it,
   * so a client hitting your server directly cant fake it, and headers you didnt list are never read
   *
   * leave it out to always use the address that connected
   *
   * rules are tried in order, the first one that gives a valid ip wins
   *
   * @example
   * ```ts
   * // cloudflared on the same machine
   * ip({ trust: "cloudflared" });
   *
   * // nginx in docker
   * ip({ trust: { proxy: "nginx", peers: "private" } });
   *
   * // custom: a header your proxy overwrites, plus a secret it adds
   * ip({
   *   trust: {
   *     header: "x-client-ip",
   *     peers: "10.0.0.0/8",
   *     verify: (req) => req.headers["x-proxy-secret"] === process.env.PROXY_SECRET
   *   }
   * });
   * ```
   */
  trust?: TrustEntry | TrustEntry[];
  /**
   * delete client ip headers from `req.headers` once the ip is resolved, so `getIp()` is the only way to get it
   * `true` removes every header any known proxy uses, an array adds your own on top
   *
   * the headers from your rules are always removed when this is on
   *
   * @default false
   */
  remove?: boolean | string[];
}

/** what was found when resolving the ip, for logs and debugging */
export interface IpInfo {
  /** the client ip, `undefined` only if the socket is already gone */
  ip: string | undefined;
  /** `"socket"` or the header the ip came from */
  source: string;
  /** the address that connected to the server, either the last proxy or the client itself */
  peer: string | undefined;
  /** the rule that answered, `undefined` when the ip is just the address that connected */
  rule?: string;
  /** why rules didnt answer, empty if the first one did, look here when nothing seems to work */
  skipped: string[];
}

/** what the {@link ip} extension adds to every request */
export interface IpRequest {
  /**
   * the client ip, or the address that connected if no rule answered
   * `undefined` only if the socket is already gone
   */
  getIp(): string | undefined;
  /** {@link getIp} plus where it came from and why rules were skipped */
  getIpInfo(): IpInfo;
}

const cloudflareRanges = [
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "108.162.192.0/18",
  "131.0.72.0/22",
  "141.101.64.0/18",
  "162.158.0.0/15",
  "172.64.0.0/13",
  "173.245.48.0/20",
  "188.114.96.0/20",
  "190.93.240.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32"
];

/**
 * the ranges behind the built in {@link PeerMatcher} names
 *
 * > [!NOTE]
 * > `cloudflare` is a copy of https://www.cloudflare.com/ips (last changed 2023)
 * > this may change in the future
 */
export const ranges = {
  loopback: ["127.0.0.0/8", "::1"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  private: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
  cloudflare: cloudflareRanges
} as const;

const knownIpHeaders = [
  "x-forwarded-for",
  "x-original-forwarded-for",
  "x-forwarded",
  "forwarded",
  "forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "cf-pseudo-ipv4",
  "fly-client-ip",
  "fastly-client-ip",
  "cloudfront-viewer-address",
  "x-envoy-external-address",
  "x-azure-clientip",
  "x-azure-socketip",
  "x-appengine-user-ip"
];

function parseAddress(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let s = input.trim();
  if (!s || s.length > 64) return undefined;

  if (s[0] === "[") {
    const end = s.indexOf("]");
    if (end < 0) return undefined;
    const rest = s.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return undefined;
    s = s.slice(1, end);
  } else {
    const colon = s.indexOf(":");
    if (colon !== -1 && colon === s.lastIndexOf(":")) {
      if (!/^\d{1,5}$/.test(s.slice(colon + 1))) return undefined;
      s = s.slice(0, colon);
    }
  }

  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);

  const family = isIP(s);
  if (!family) return undefined;
  if (family === 4) return s;

  s = s.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted && isIP(dotted[1]!) === 4) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return s;
}

type Matcher = (ip: string | undefined, req?: IncomingMessage) => boolean;

function matcher(
  input: PeerMatcher | PeerMatcher[],
  thing: string,
  allowEmpty = false
): Matcher {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length && !allowEmpty) {
    throw new TypeError(`httptree-ext-ip: ${thing} can not be empty`);
  }

  const block = new BlockList();
  const fns: ((ip: string) => boolean)[] = [];
  let any = false;
  let unix = false;

  const add = (cidr: string) => {
    const [addr = "", prefix] = cidr.split("/");
    const family = isIP(addr);
    const bad = () =>
      new TypeError(`httptree-ext-ip: "${cidr}" in ${thing} is unknown`);
    if (!family) throw bad();
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) return block.addAddress(addr, type);
    const n = Number(prefix);
    if (!/^\d+$/.test(prefix) || n > (family === 4 ? 32 : 128)) throw bad();
    block.addSubnet(addr, n, type);
  };

  for (const m of list) {
    if (typeof m === "function") fns.push(m);
    else if (m === "any") any = true;
    else if (m === "unix") unix = true;
    else if (Object.prototype.hasOwnProperty.call(ranges, m)) {
      ranges[m as keyof typeof ranges].forEach(add);
    } else add(m);
  }

  return (ip, req) => {
    if (ip === undefined) return unix && !req?.socket?.destroyed;
    if (any) return true;
    if (block.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4")) return true;
    return fns.some((fn) => fn(ip));
  };
}

function splitOutsideQuotes(value: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && quoted) {
      current += c + (value[++i] ?? "");
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === sep && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current);
  return out;
}

function forwardedEntries(value: string): string[] {
  return splitOutsideQuotes(value, ",").map((element) => {
    let found = "";
    for (const pair of splitOutsideQuotes(element, ";")) {
      const eq = pair.indexOf("=");
      if (eq < 1 || pair.slice(0, eq).trim().toLowerCase() !== "for") continue;
      let v = pair.slice(eq + 1).trim();
      if (v.length > 1 && v[0] === '"' && v.endsWith('"')) v = v.slice(1, -1);
      found = v;
    }
    return found;
  });
}

type Read = { ip?: string; reason?: string };

interface CompiledRule {
  name: string;
  header: string;
  peers: Matcher;
  verify?: (req: IncomingMessage) => boolean;
  read(value: string): Read;
}

const headerName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function presetOf(name: string): ProxyRule {
  if (!Object.prototype.hasOwnProperty.call(proxies, name)) {
    throw new TypeError(`httptree-ext-ip: unknown proxy "${name}"`);
  }
  return proxies[name as ProxyName];
}

function compileRule(entry: TrustEntry): CompiledRule {
  let rule: ProxyRule;
  let name: string | undefined;

  if (typeof entry === "string") {
    rule = presetOf(entry);
    name = entry;
  } else if ("proxy" in entry) {
    const { proxy, ...changes } = entry;
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, v]) => v !== undefined)
    );
    rule = { ...presetOf(proxy), ...defined } as ProxyRule;
    name = proxy;
  } else {
    rule = entry;
  }

  name = rule.name ?? name ?? String(rule.header);
  const label = `rule "${name}"`;

  if (typeof rule.header !== "string" || !headerName.test(rule.header)) {
    throw new TypeError(`httptree-ext-ip: ${label} needs a valid header name`);
  }
  if (rule.peers === undefined) {
    throw new TypeError(
      `httptree-ext-ip: ${label} needs peers who is allowed to send ${rule.header}`
    );
  }

  const format = rule.format ?? "single";
  if (!["single", "list", "forwarded"].includes(format)) {
    throw new TypeError(
      `httptree-ext-ip: ${label} has an unknown format "${format}"`
    );
  }
  if (
    format === "single" &&
    (rule.hops !== undefined || rule.skip !== undefined)
  ) {
    throw new TypeError(
      `httptree-ext-ip: ${label} is a single ip, hops and skip are for lists`
    );
  }
  if (
    rule.hops !== undefined &&
    (!Number.isInteger(rule.hops) || rule.hops < 0)
  ) {
    throw new TypeError(`httptree-ext-ip: ${label} needs hops to be 0 or more`);
  }

  const peers = matcher(rule.peers, `peers of ${label}`);
  const skip =
    rule.skip === undefined
      ? undefined
      : matcher(rule.skip, `skip of ${label}`, true);
  const hops = rule.hops;

  const read = (value: string): Read => {
    if (format === "single") {
      const ip = parseAddress(value);
      return ip ? { ip } : { reason: `${rule.header} is not a single ip` };
    }

    const entries =
      format === "list" ? value.split(",") : forwardedEntries(value);
    let i = entries.length - 1;

    if (hops !== undefined) {
      if (entries.length <= hops) {
        return {
          reason: `${rule.header} has ${entries.length} entries, expected more than ${hops}`
        };
      }
      i -= hops;
    }

    for (; i >= 0; i--) {
      const ip = parseAddress(entries[i]);
      if (!ip)
        return { reason: `entry ${i + 1} of ${rule.header} is not an ip` };
      if (skip?.(ip)) continue;
      return { ip };
    }

    const first = parseAddress(entries[0]);
    return first
      ? { ip: first }
      : { reason: `${rule.header} has no usable entry` };
  };

  return {
    name,
    header: rule.header.toLowerCase(),
    peers,
    verify: rule.verify,
    read
  };
}

function compileTrust(options: IpOptions): CompiledRule[] {
  const { trust } = options;
  if (trust === undefined) return [];
  return (Array.isArray(trust) ? trust : [trust]).map(compileRule);
}

function resolver(rules: CompiledRule[]): (req: IncomingMessage) => IpInfo {
  return (req) => {
    const peer = parseAddress(req.socket?.remoteAddress);
    const skipped: string[] = [];

    for (const rule of rules) {
      if (!rule.peers(peer, req)) {
        skipped.push(
          `${rule.name}: ${peer ?? "this peer"} is not allowed to send ${rule.header}`
        );
        continue;
      }

      if (rule.verify) {
        let ok = false;
        try {
          ok = rule.verify(req) === true;
        } catch {}
        if (!ok) {
          skipped.push(`${rule.name}: verify did not pass`);
          continue;
        }
      }

      const raw = req.headers[rule.header];
      if (raw === undefined) {
        skipped.push(`${rule.name}: no ${rule.header} header`);
        continue;
      }

      const result = rule.read(Array.isArray(raw) ? raw.join(", ") : raw);
      if (result.ip) {
        return {
          ip: result.ip,
          source: rule.header,
          peer,
          rule: rule.name,
          skipped
        };
      }
      skipped.push(`${rule.name}: ${result.reason}`);
    }

    return { ip: peer, source: "socket", peer, skipped };
  };
}

/**
 * resolves the client ip, see {@link IpRequest}
 *
 * with no options it's just the address that connected
 * a proxy is only trusted if you list it in {@link IpOptions.trust}
 *
 * > [!WARNING]
 * > your proxy has to overwrite (or append to) the trusted header on every request
 * > one that passes a client's value through looks exactly like a real one
 * > use `verify` to tell them apart when you cant be sure
 *
 * @example
 * ```ts
 * const tree = root().extend(ip({ trust: "cloudflared" }));
 *
 * tree.get("/", (req) => req.getIp());
 * ```
 */
export function ip(options: IpOptions = {}): Extension<IpRequest> {
  const rules = compileTrust(options);
  const resolve = resolver(rules);
  const info = perRequestLazy<IpInfo>((req) => resolve(req as IncomingMessage));

  const removeList = options.remove
    ? [
        ...new Set([
          ...knownIpHeaders,
          ...(Array.isArray(options.remove) ? options.remove : []).map((h) =>
            h.toLowerCase()
          ),
          ...rules.map((rule) => rule.header)
        ])
      ]
    : [];

  const remove = (req: IncomingMessage) => {
    info.get(req);
    for (const header of removeList) delete req.headers[header];
  };

  return defineExtension<IpRequest>({
    name: "ip",
    request: {
      getIp(): string | undefined {
        return info.get(this).ip;
      },
      getIpInfo(): IpInfo {
        return info.get(this);
      }
    },
    setup(root) {
      if (!removeList.length) return;
      root.use((req) => {
        remove(req as IncomingMessage);
      }, 1000);
      root.useWS((req) => {
        remove(req as IncomingMessage);
      }, 1000);
    }
  });
}
