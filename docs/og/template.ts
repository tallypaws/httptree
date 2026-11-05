import { img } from "./config.ts";
import { tokenColor } from "./colors.ts";
import { shapeFor, letterFor } from "./shapes.ts";
import type { Page, Token } from "./types.ts";

const width = img.width;
const height = img.height;
const padX = 64;
const padY = 52;

const bg = "#1c1b1f";
const fg = "#e5e1e6";
const muted = "#918f9a";
const desc = "#c8c5d0";
const code = "#131316";

export const fonts = { sans: "Nunito", code: "Code" };

function mergeSpaces(line: Token[]): Token[] {
  const out: Token[] = [];
  let lead = "";
  for (const tok of line) {
    if (!tok.t.trim()) {
      if (out.length) out.at(-1)!.t += tok.t;
      else lead += tok.t;
    } else {
      out.push({ ...tok, t: lead + tok.t });
      lead = "";
    }
  }
  return out.map((t) => ({ ...t, t: t.t.replace(/ /g, "\u00a0") }));
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

export function rgba(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c: string) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface El {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: unknown;
    [attr: string]: unknown;
  };
}

const h = (
  type: string,
  style: Record<string, unknown>,
  ...children: unknown[]
): El => ({
  type,
  props: {
    style: { display: "flex", ...style },
    children: children.length === 1 ? children[0] : children
  }
});

export function layout(page: Page) {
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const pathH = 30;
  const pathPad = -10;
  const headH = 84;
  const gaps = { path: 12, sig: 26, desc: 22 };

  let used = pathH + gaps.path + headH;
  let sig: {
    lines: Token[][];
    fontSize: number;
    lineH: number;
    padX: number;
    padY: number;
    boxH: number;
  } | null = null;

  if (page.signature) {
    const padX = 28;
    const padY = 22;
    let lines = page.signature.map(mergeSpaces);
    const maxLen = Math.max(
      ...lines.map((l) => l.reduce((n, t) => n + t.t.length, 0)),
      1
    );
    const fontSize = clamp(
      Math.floor((innerW - padX * 2) / (maxLen * 0.64)),
      16,
      30
    );
    const lineH = Math.round(fontSize * 1.42);
    const minDesc = 96;
    const room = innerH - used - gaps.sig - gaps.desc - minDesc - padY * 2;
    const maxLines = Math.max(3, Math.floor(room / lineH));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines - 1);
      lines.push([{ t: "...", c: "tsd-signature-symbol" }]);
    }
    const boxH = lines.length * lineH + padY * 2;
    sig = { lines, fontSize, lineH, padX, padY, boxH };
    used += gaps.sig + boxH;
  }

  used += gaps.desc;
  const descH = innerH - used;
  const descFont = sig ? 30 : 36;
  const descLine = Math.round(descFont * 1.42);
  const paraGap = 14;

  const perLine = Math.floor(innerW / (descFont * 0.5));
  const paragraphs: string[] = [];
  let total = 0;
  let textH = 0;
  for (const p of page.paragraphs) {
    if (total > 900) break;
    const t = p.length > 420 ? p.slice(0, 420) : p;
    total += t.length;
    paragraphs.push(t);
    textH +=
      Math.ceil(t.length / perLine) * descLine +
      (paragraphs.length > 1 ? paraGap : 0);
  }
  const overflow =
    textH > descH - 6 || page.paragraphs.length > paragraphs.length;

  return {
    innerW,
    innerH,
    pathH,
    pathPad,
    headH,
    gaps,
    sig,
    descH,
    descFont,
    descLine,
    paraGap,
    paragraphs,
    overflow
  };
}

export function card(page: Page): El {
  const L = layout(page);
  const { color, colors } = page;

  const shapeSize = 66;
  const nameFont = clamp(
    Math.floor(
      (L.innerW - shapeSize - 28) / (Math.max(page.name.length, 1) * 0.6)
    ),
    34,
    68
  );

  const glowSize = 670;
const noiseQuad =
  'url(\'data:image/svg+xml,%3Csvg viewBox="0 0 200 200" xmlns="http://w3.org"%3E%3Cfilter id="noiseFilter"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23noiseFilter)" opacity="0.15"/%3E%3C/svg%3E\')';


  const glow = h("div", {
    position: "absolute",
    left: padX + shapeSize / 2 - glowSize / 2,
    top: padY + L.pathH + L.pathPad + L.gaps.path + L.headH / 2 - glowSize / 2,
    width: glowSize,
    height: glowSize,
    backgroundImage: `${noiseQuad}, radial-gradient(circle at 50% 50%, ${rgba(color, 0.07)} 0%, ${rgba(color, 0.01)} 30%, ${rgba(color, 0)} 70%)`
  });

  const path = h(
    "div",
    {
      height: L.pathH + 8,
      marginBottom: L.pathPad,
      alignItems: "center",
      fontFamily: fonts.sans,
      fontSize: 25,
      color: muted
    },
    page.pathLabel
  );

  const shape = h(
    "div",
    {
      position: "relative",
      width: shapeSize,
      height: shapeSize,
      alignItems: "center",
      justifyContent: "center"
    },
    {
      type: "svg",
      props: {
        width: shapeSize,
        height: shapeSize,
        viewBox: "0 0 24 24",
        style: { position: "absolute", left: 0, top: 0 },
        children: [
          {
            type: "path",
            props: {
              d: shapeFor(page.kind),
              fill: color,
              "fill-opacity": 0.2,
              stroke: color,
              "stroke-width": 1.5,
              "stroke-linejoin": "round"
            }
          }
        ]
      }
    },
    h(
      "div",
      { fontFamily: fonts.sans, fontWeight: 800, fontSize: 38, color },
      letterFor(page.kind) + ""
    )
  );

  const name = h(
    "div",
    {
      fontFamily: fonts.sans,
      fontWeight: 800,
      fontSize: nameFont,
      color: fg,
      whiteSpace: "nowrap"
    },
    page.name
  );

  const header = h(
    "div",
    { height: L.headH, alignItems: "center", gap: 28 },
    shape,
    name
  );

  const children = [path, h("div", { height: L.gaps.path }), header];

  if (L.sig) {
    const { lines, fontSize, lineH, padX, padY } = L.sig;
    const rows = lines.map((line) =>
      h(
        "div",
        {
          height: lineH,
          alignItems: "center",
          fontFamily: fonts.code,
          fontSize
        },
        line.length
          ? line.map((tok) =>
              h(
                "span",
                { whiteSpace: "pre", color: tokenColor(colors, tok.c, tok.t) },
                tok.t
              )
            )
          : h("span", { whiteSpace: "pre" }, " ")
      )
    );
    children.push(
      h(
        "div",
        {
          marginTop: L.gaps.sig,
          width: L.innerW - padX * 2 - 2,
          flexDirection: "column",
          padding: `${padY}px ${padX}px`,
          backgroundColor: code,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 18,
          overflow: "hidden"
        },
        ...rows
      )
    );
  }

  children.push(
    h(
      "div",
      {
        marginTop: L.gaps.desc,
        width: L.innerW,
        height: L.descH,
        overflow: "hidden",
        flexDirection: "column",
        gap: L.paraGap,
        fontFamily: fonts.sans,
        fontWeight: 400,
        fontSize: L.descFont,
        lineHeight: `${L.descLine}px`,
        color: desc
      },
      ...L.paragraphs.map((p) => h("div", {}, p))
    )
  );

  if (L.overflow) {
    children.push(
      h("div", {
        position: "absolute",
        left: 0,
        bottom: 140,
        width,
        height: 100,
        backgroundImage: `linear-gradient(to bottom, ${rgba(bg, 0)} 0%, ${rgba(bg, 0.1)} 62%, ${rgba(bg, 1)} 100%)`
      })
    );
  }

  children.push(glow)

  return h(
    "div",
    {
      position: "relative",
      flexDirection: "column",
      width: width,
      height: height,
      padding: `${padY}px ${padX}px`,
      backgroundColor: bg,
      overflow: "hidden"
    },
    ...children
  );
}
