import fs from "node:fs";
import path from "node:path";
import type { Colors, Kind } from "./types.ts";

const cssf = ["style.css", "material-style.css", "custom.css"];
let cached: { sig: string; map: Colors } | null = null;

export function loadColors(generatedDir: string): Colors {
  const dir = path.join(generatedDir, "assets");
  const files = cssf.map((f) => path.join(dir, f));
  const sig = files
    .map((f) => {
      try {
        return fs.statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    })
    .join("|");
  if (cached && cached.sig === sig) return cached.map;

  const raw = {} as { [x: string]: string };
  for (const f of files) {
    let css: string;
    try {
      css = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of css.matchAll(/--dark-(color-[a-z-]+):\s*([^;}]+)/g)) {
      raw[m[1]!] = m[2]!.trim();
    }
  }

  const resolve = (name: string, depth = 0): string | null => {
    const v = raw[name];
    if (!v || depth > 8) return null;
    const ref = v.match(/^var\(\s*--dark-([a-z-]+)\s*\)$/);
    if (ref) return resolve(ref[1]!, depth + 1);
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : null;
  };

  const map: Colors = {};
  for (const name of Object.keys(raw)) {
    const v = resolve(name);
    if (v) map[name] = v;
  }
  cached = { sig, map };
  return map;
}

const KIND_VAR: Record<string, string> = {
  function: "function",
  interface: "interface",
  class: "class",
  type: "type-alias",
  variable: "variable",
  enum: "enum",
  namespace: "namespace",
  module: "module",
  project: "project",
  guide: "project",
  page: "project"
};

export function kindColor(colors: Colors, kind: Kind): string {
  return (
    colors[`color-ts-${KIND_VAR[kind] ?? "project"}`] ??
    colors["color-ts-project"] ??
    "#c2c1ff"
  );
}

const PRIMITIVES = new Set([
  "string",
  "number",
  "boolean",
  "unknown",
  "any",
  "void",
  "null",
  "undefined",
  "never",
  "object",
  "bigint",
  "symbol",
  "true",
  "false"
]);

export function tokenColor(colors: Colors, cls: string, text: string): string {
  const kind = cls.match(/tsd-kind-([a-z-]+)/)?.[1];
  if (kind && colors[`color-ts-${kind}`]) return colors[`color-ts-${kind}`]!;
  if (cls.includes("tsd-signature-keyword"))
    return colors["color-ts-keyword"] ?? "#3399ff";
  if (cls.includes("tsd-signature-symbol"))
    return colors["color-text-aside"] ?? "#dddddd";
  if (cls.includes("tsd-signature-type")) {
    return PRIMITIVES.has(text.trim())
      ? (colors["color-ts-keyword"] ?? "#3399ff")
      : (colors["color-text"] ?? "#f8f8f8");
  }
  return colors["color-text-aside"] ?? "#dddddd";
}
