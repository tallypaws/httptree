import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { img } from "./config.ts";
import type { Page } from "./types.ts";
import type * as Template from "./template.ts";

type Fonts = Parameters<typeof satori>[1]["fonts"];
type Rendered = { version: string; svg: string; png: Uint8Array };

const require = createRequire(import.meta.url);
const ogDir = import.meta.dirname;
const templateFile = path.join(ogDir, "template.ts");
const codeFont = path.resolve(ogDir, "../public/font/courierprimecode.ttf");

let tpl: { m: number; mod: typeof Template } | null = null;
async function loadTemplate(): Promise<typeof Template> {
  const m = fs.statSync(templateFile).mtimeMs;
  if (tpl && tpl.m === m) return tpl.mod;
  const mod = await import(`${pathToFileURL(templateFile).href}?v=${m}`);
  tpl = { m, mod };
  return mod;
}

let fontData: { family: string; list: Fonts } | null = null;
function loadFonts(family: { sans: string; code: string }): Fonts {
  if (fontData && fontData.family === family.sans + family.code)
    return fontData.list;
  const nunito = path.join(
    path.dirname(require.resolve("@fontsource/nunito/package.json")),
    "files"
  );
  const sans = (weight: 400 | 800) => ({
    name: family.sans,
    weight,
    style: "normal" as const,
    data: fs.readFileSync(
      path.join(nunito, `nunito-latin-${weight}-normal.woff`)
    )
  });
  const list = [
    sans(400),
    sans(800),
    {
      name: family.code,
      weight: 400 as const,
      style: "normal" as const,
      data: fs.readFileSync(codeFont)
    }
  ];
  fontData = { family: family.sans + family.code, list };
  return list;
}

const cache = new Map<string, Rendered>();
const inflight = new Map<
  string,
  { version: string; promise: Promise<Rendered> }
>();

export function renderOg(page: Page): Promise<Rendered> {
  const hit = cache.get(page.slug);
  if (hit && hit.version === page.version) return Promise.resolve(hit);
  const pending = inflight.get(page.slug);
  if (pending && pending.version === page.version) return pending.promise;

  const promise = (async () => {
    const { card, fonts } = await loadTemplate();
    const svg = await satori(card(page), {
      width: img.width,
      height: img.height,
      fonts: loadFonts(fonts)
    });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: img.width } })
      .render()
      .asPng();
    const out: Rendered = { version: page.version, svg, png };
    cache.set(page.slug, out);
    return out;
  })().finally(() => {
    if (inflight.get(page.slug)?.promise === promise)
      inflight.delete(page.slug);
  });
  inflight.set(page.slug, { version: page.version, promise });
  return promise;
}
