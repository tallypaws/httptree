import fs from "node:fs";
import path from "node:path";
import { url, desc } from "./config.ts";
import { loadColors, kindColor } from "./colors.ts";
import type {
  Colors,
  Kind,
  Page,
  ParsedPage,
  Signature,
  Token
} from "./types.ts";

const kindPrefix: Record<string, Kind> = {
  Interface: "interface",
  Class: "class",
  Function: "function",
  "Type Alias": "type",
  Variable: "variable",
  Enumeration: "enum",
  Namespace: "namespace",
  Module: "module"
};

const parts: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " "
};

export function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m: string, e: string) => {
    if (e[0] === "#") {
      const n =
        e[1]!.toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return parts[e.toLowerCase()] ?? m;
  });
}

export const text = (html: string): string =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

function blocks(fragment: string, limit = 6): string[] {
  const clean = fragment.replace(/<pre[\s\S]*?<\/pre>/g, "");
  const out: string[] = [];
  for (const m of clean.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const t = text(m[2]!);
    if (!t) continue;
    out.push(m[1] === "li" ? `• ${t}` : t);
    if (out.length >= limit) break;
  }
  return out;
}

function summaryBlocks(html: string, rel: string): string[] {
  if (rel === "index.html" || rel.startsWith("documents/")) {
    const i = html.indexOf('tsd-typography">');
    return i < 0 ? [] : blocks(html.slice(i, i + 30000));
  }
  const i = html.indexOf('class="tsd-comment tsd-typography">');
  if (i < 0) return [];
  const rest = html.slice(i + 'class="tsd-comment tsd-typography">'.length);
  const end = rest.search(/<div\b|<\/div>/);
  return blocks(end < 0 ? rest : rest.slice(0, end));
}

function parseSignature(html: string): Signature | null {
  const start = html.search(/<div class="tsd-signature\b[^"]*"[^>]*>/);
  if (start < 0) return null;
  const open = html.indexOf(">", start) + 1;
  const end = html.indexOf("</div>", open);
  if (end < 0) return null;
  const block = html
    .slice(open, end)
    .replace(/<a [^>]*tsd-anchor-icon[^>]*>[\s\S]*?<\/a>/g, "");

  const lines: Token[][] = [[]];
  const re =
    /<br\s*\/?>|<(span|a)\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/\1>|([^<]+)/g;
  for (const m of block.matchAll(re)) {
    if (m[0].startsWith("<br")) lines.push([]);
    else if (m[1]) lines.at(-1)!.push({ t: text(m[3]!), c: m[2]! });
    else if (m[4])
      lines.at(-1)!.push({ t: decode(m[4]).replace(/\n/g, ""), c: "" });
  }
  const cleaned = lines
    .map((l) => {
      while (l.length && !l.at(-1)!.t.trim()) l.pop();
      return l;
    })
    .filter((l, i, a) => l.length || (i > 0 && i < a.length - 1));
  return cleaned.length ? cleaned : null;
}

function pathLabel(kind: Kind, crumbs: string[], rel: string): string {
  if (rel === "index.html") return new URL(url).host;
  if (kind === "guide") return "guides/";
  const parents = crumbs.slice(0, -1);
  if (parents.length === 0) return "httptree/";
  const [first = "", ...rest] = parents;
  const base =
    first === "core" ? "core" : first === "extensions" ? "ext" : first;
  return [base, ...rest].join("/") + "/";
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (
    (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…"
  );
}

function sentences(s: string, n: number): string {
  const out: string[] = [];
  let len = 0;
  for (const part of s.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
    if (len + part.length > n) break;
    out.push(part);
    len += part.length + 1;
  }
  return out.length ? out.join(" ") : truncate(s, n);
}

function preview(blocks: string[], n: number): string[] {
  const out: string[] = [];
  let len = 0;
  const lead = blocks.findIndex((b) => b.endsWith(":"));
  const head = lead > 0 ? blocks.slice(0, lead) : blocks;
  for (const b of head.slice(0, (head[0]?.length ?? 0) < 60 ? 2 : 1)) {
    if (len + b.length > n) {
      if (!out.length) out.push(sentences(b, n));
      break;
    }
    out.push(b);
    len += b.length;
  }
  return out;
}

function parsePage(html: string, rel: string): ParsedPage {
  const crumbHtml =
    html.match(/<ul class="tsd-breadcrumb"[\s\S]*?<\/ul>/)?.[0] ?? "";
  const crumbs = [
    ...crumbHtml.matchAll(/<li>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/g)
  ].map((m) => text(m[1]!));
  const h1 = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");

  let kind: Kind = "page";
  let name = crumbs.at(-1) ?? h1;
  const prefix = Object.keys(kindPrefix).find((p) => h1.startsWith(p + " "));
  if (prefix) kind = kindPrefix[prefix]!;
  else if (rel.startsWith("documents/")) kind = "guide";
  else if (rel === "index.html") {
    kind = "project";
    name = h1 || "httptree";
  }
  if (!name) name = h1 || rel;

  const paragraphs = preview(summaryBlocks(html, rel), 300);
  const plain = paragraphs.map((p) => p.replace(/^• /, ""));
  const description = truncate(plain.join(" ") || desc, 300);
  const summary = truncate(plain[0] || desc, 160);

  const kindLabel = kind === "project" || kind === "page" ? "docs" : kind;
  const signature = ["function", "type", "variable"].includes(kind)
    ? parseSignature(html)
    : null;
  const sourceUrl =
    html.match(/<a href="(https:\/\/github\.com\/[^"]*\/blob\/[^"]+)"/)?.[1] ??
    null;
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? name);

  return {
    rel,
    kind,
    kindLabel,
    name,
    title: rel === "index.html" ? "httptree docs" : title,
    pathLabel: pathLabel(kind, crumbs, rel),
    paragraphs,
    description,
    summary,
    signature,
    sourceUrl
  };
}

export function createPages({
  generatedDir,
  ogDir
}: {
  generatedDir: string;
  ogDir: string;
}) {
  const cache = new Map<string, { key: string; page: ParsedPage }>();
  const root = path.resolve(generatedDir);

  function templateMtime() {
    let m = 0;
    try {
      for (const f of fs.readdirSync(ogDir)) {
        if (!/\.[cm]?[jt]s$/.test(f)) continue;
        m = Math.max(m, fs.statSync(path.join(ogDir, f)).mtimeMs);
      }
    } catch {}
    return m;
  }

  function locate(pathname: string): string | null {
    let p: string;
    try {
      p = decodeURIComponent(pathname.split("?")[0] ?? "");
    } catch {
      return null;
    }
    p = p.replace(/^\/+|\/+$/g, "").replace(/\.html$/i, "");
    if (p === "" || p === "index") return "index.html";
    if (
      p.split("/").some((s) => s === ".." || s === "") ||
      /^(assets|media|_og)(\/|$)/.test(p)
    )
      return null;
    for (const cand of [`${p}.html`, `${p}/index.html`]) {
      const full = path.resolve(root, cand);
      if (!full.startsWith(root + path.sep)) continue;
      try {
        if (fs.statSync(full).isFile()) return cand;
      } catch {}
    }
    return null;
  }

  function get(pathname: string): Page | null {
    const rel = locate(pathname);
    if (!rel) return null;
    const full = path.join(root, rel);
    console.log({ pathname });

    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      return null;
    }
    const colors: Colors = loadColors(root);
    const key = `${st.mtimeMs}`;
    let entry = cache.get(rel);
    if (!entry || entry.key !== key) {
      entry = { key, page: parsePage(fs.readFileSync(full, "utf8"), rel) };
      if (pathname === "/index" || pathname === "/") {
        entry.page.description === "hi";
        entry.page.paragraphs = [
          "a small, typed routing package built around node's built-in http server."
        ];
        entry.page.summary = "hi3";
        entry.page.title = "httptree docs";
        entry.page.kindLabel="??"
        //   entry.page.signature = [
        //     [
        //       { t: "const", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "tree", c: "tsd-kind-property" },
        //       { t: " ", c: "" },
        //       { t: "=", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "root", c: "tsd-kind-call-signature" },
        //       { t: "(", c: "tsd-signature-symbol" },
        //       { t: ")", c: "tsd-signature-symbol" }
        //     ],
        //     [
        //       { t: "tree.get", c: "tsd-kind-call-signature" },
        //       { t: "(", c: "tsd-signature-symbol" },
        //       { t: '"/"', c: "tsd-signature-type" },
        //       { t: ",", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "(", c: "tsd-signature-symbol" },
        //       { t: ")", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "=>", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "{", c: "tsd-signature-symbol" }
        //     ],
        //     [
        //       { t: "    ", c: "" },
        //       { t: "return", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: '"OK"', c: "tsd-signature-type" }
        //     ],
        //     [
        //       { t: "}", c: "tsd-signature-symbol" },
        //       { t: ")", c: "tsd-signature-symbol" }
        //     ],
        //     [],
        //     [
        //       { t: "tree.delete", c: "tsd-kind-call-signature" },
        //       { t: "(", c: "tsd-signature-symbol" },
        //       { t: '"/post/[id]"', c: "tsd-signature-type" },
        //       { t: ",", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "(", c: "tsd-signature-symbol" },
        //       { t: "{", c: "tsd-signature-symbol" },
        //       { t: "params", c: "tsd-kind-property" },
        //       { t: "}", c: "tsd-signature-symbol" },
        //       { t: ")", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "=>", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "{", c: "tsd-signature-symbol" }
        //     ],
        //     [
        //       { t: "    ", c: "" },
        //       { t: "db.delete", c: "tsd-kind-call-signature" },
        //       { t: "(", c: "tsd-signature-symbol" },
        //       { t: "params.id", c: "tsd-signature-type" },
        //       { t: ")", c: "tsd-signature-symbol" }
        //     ],
        //     [
        //       { t: "    ", c: "" },
        //       { t: "return", c: "tsd-signature-symbol" },
        //       { t: " ", c: "" },
        //       { t: "`", c: "tsd-signature-symbol" },
        //       { t: "${params.id} deleted", c: "tsd-signature-type" },
        //       { t: "`", c: "tsd-signature-symbol" }
        //     ],
        //     [
        //       { t: "}", c: "tsd-signature-symbol" },
        //       { t: ")", c: "tsd-signature-symbol" }
        //     ]
        //   ];
      }
      console.log(entry.page.signature);
      cache.set(rel, entry);
    }
    const slug = rel.replace(/\.html$/, "").replace(/\/index$/, "") || "index";
    const version = Math.floor(Math.max(st.mtimeMs, templateMtime())).toString(
      36
    );
    const urlPath =
      rel === "index.html" ? "/" : "/" + rel.replace(/\.html$/, "");
    return {
      ...entry.page,
      colors,
      color: kindColor(colors, entry.page.kind),
      slug,
      version,
      urlPath,
      url: url + urlPath,
      imageUrl: `${url}/_og/${slug}.png?v=${version}`
    };
  }

  function list(): string[] {
    const out = ["/"];
    for (const f of ["modules.html", "hierarchy.html"]) {
      if (fs.existsSync(path.join(root, f)))
        out.push("/" + f.replace(/\.html$/, ""));
    }
    for (const d of [
      "documents",
      "modules",
      "classes",
      "interfaces",
      "types",
      "functions",
      "variables"
    ]) {
      let files: string[] = [];
      try {
        files = fs
          .readdirSync(path.join(root, d))
          .filter((f) => f.endsWith(".html"))
          .sort();
      } catch {}
      for (const f of files) out.push(`/${d}/${f.replace(/\.html$/, "")}`);
    }
    return out;
  }

  return { get, list, locate, templateMtime };
}
