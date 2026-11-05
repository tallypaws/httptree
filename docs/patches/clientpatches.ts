import type { StaticPatch } from "@tally.paws/webpatcher";
import { buildSync } from "esbuild";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const clientPatchDir = path.resolve(import.meta.dirname, "./client");
const runtime = path.resolve(import.meta.dirname, "./ctx.ts");
const recheckInterval = 500;

function entry(imports: string, list: string): string {
  return [
    `import { createPatchContext } from ${JSON.stringify(runtime)};`,
    imports,
    `const entries: Array<[string, any]> = [${list}];`,
    `function matchRoute(pathname: string, patterns?: string[]): boolean {`,
    `  if (!patterns || patterns.length === 0) return true;`,
    `  for (const p of patterns) {`,
    `    if (p === "*") return true;`,
    `    if (p.endsWith("/*")) { if (pathname.startsWith(p.slice(0, -1))) return true; }`,
    `    else if (pathname === p) return true;`,
    `  }`,
    `  return false;`,
    `}`,
    `async function boot() {`,
    `  const pathname = location.pathname;`,
    `  await Promise.all(entries.map(async ([name, mod]) => {`,
    `    const patch = mod.default ?? mod;`,
    `    if (!matchRoute(pathname, patch.match)) return;`,
    `    if (typeof patch.run !== "function") {`,
    `      console.warn("[webpatcher] patch " + name + " has no run() export");`,
    `      return;`,
    `    }`,
    `    const ctx = createPatchContext(pathname);`,
    `    try {`,
    `      await patch.run(ctx);`,
    `      console.debug("[webpatcher] applied: " + name);`,
    `    } catch (err) {`,
    `      console.error("[webpatcher] patch " + name + " threw:", err);`,
    `      ctx.cleanup();`,
    `    }`,
    `  }));`,
    `}`,
    `boot().catch((err) => console.error("[webpatcher] boot failed:", err));`
  ].join("\n");
}

function listClientFiles(): string[] {
  try {
    return (readdirSync(clientPatchDir, { recursive: true }) as string[])
      .filter(
        (f) =>
          /\.[cm]?[jt]s$/.test(f) &&
          !f.endsWith(".d.ts") &&
          !f.split(path.sep).some((part) => part.startsWith("_"))
      )
      .sort()
      .map((f) => path.join(clientPatchDir, f));
  } catch {
    return [];
  }
}

function signature(files: string[]): string {
  return [...new Set(files)]
    .sort()
    .map((f) => {
      try {
        return `${f}:${statSync(f).mtimeMs}`;
      } catch {
        return `${f}:gone`;
      }
    })
    .join("|");
}

interface State {
  sig: string;
  code: string | null;
  deps: string[];
}

let state: State | null = null;
let lastCheck = 0;

function bundle(files: string[]): { code: string; deps: string[] } {
  const imports = files
    .map((f, i) => `import * as m${i} from ${JSON.stringify(f)};`)
    .join("\n");
  const list = files
    .map((f, i) => {
      const name = path
        .relative(clientPatchDir, f)
        .replace(/\.[^.]+$/, "")
        .split(path.sep)
        .join("/");
      return `[${JSON.stringify(name)}, m${i}]`;
    })
    .join(", ");

  const result = buildSync({
    stdin: {
      contents: entry(imports, list),
      resolveDir: clientPatchDir,
      loader: "ts",
      sourcefile: "webpatcher-client.ts"
    },
    bundle: true,
    write: false,
    metafile: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    logLevel: "silent"
  });

  const deps = Object.keys(result.metafile.inputs)
    .filter((k) => k !== "<stdin>")
    .map((k) => path.resolve(process.cwd(), k));
  return { code: result.outputFiles[0]!.text, deps };
}

function current(): string | null {
  const now = Date.now();
  if (state && now - lastCheck < recheckInterval) return state.code;
  lastCheck = now;

  const files = listClientFiles();
  const sig = signature([...files, runtime, ...(state?.deps ?? [])]);
  if (state && state.sig === sig) return state.code;

  if (files.length === 0) {
    state = { sig, code: null, deps: [] };
    return null;
  }
  try {
    const { code, deps } = bundle(files);
    state = { sig: signature([...files, runtime, ...deps]), code, deps };
    console.log(
      `client patches: bundled ${files.length} patch(es), ${code.length} bytes`
    );
  } catch (err) {
    console.error("client patches: build failed:", (err as Error).message);
    state = { sig, code: state?.code ?? null, deps: state?.deps ?? [] };
  }
  return state.code;
}

current();

export default {
  name: "client-patches",
  scaffold: "<head",
  match: /<head(?:\s[^>]*)?>/i,
  maxBuffer: 256 * 1024,
  transform(matched: string) {
    const code = current();
    if (!code) return matched;
    const safe = code.replace(/<\/script/gi, "<\\/script");
    return `${matched}\n<script type="module">${safe}</script>`;
  }
} satisfies StaticPatch;
