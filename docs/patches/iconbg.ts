import type { StaticPatch } from "@tally.paws/webpatcher";

const fallbackOpacity = "0.2";
const letterSize: number | null = 12;

const r = 3;

function ngon(
  n: number,
  R: number,
  rot: number,
  r: number,
  cx = 12,
  cy = 12
): string {
  const vertices: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    vertices.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }

  const pathCommands: string[] = [];

  for (let i = 0; i < n; i++) {
    const pPrev = vertices[(i - 1 + n) % n]!;
    const pCurr = vertices[i]!;
    const pNext = vertices[(i + 1) % n]!;

    const dxPrev = pPrev[0] - pCurr[0];
    const dyPrev = pPrev[1] - pCurr[1];
    const lenPrev = Math.hypot(dxPrev, dyPrev);

    const dxNext = pNext[0] - pCurr[0];
    const dyNext = pNext[1] - pCurr[1];
    const lenNext = Math.hypot(dxNext, dyNext);

    const maxR = Math.min(lenPrev, lenNext) / 2;
    const currentR = Math.min(r, maxR);

    const startX = pCurr[0] + (dxPrev / lenPrev) * currentR;
    const startY = pCurr[1] + (dyPrev / lenPrev) * currentR;

    const endX = pCurr[0] + (dxNext / lenNext) * currentR;
    const endY = pCurr[1] + (dyNext / lenNext) * currentR;

    if (i === 0) {
      pathCommands.push(`M ${startX} ${startY}`);
    } else {
      pathCommands.push(`L ${startX} ${startY}`);
    }

    pathCommands.push(`Q ${pCurr[0]} ${pCurr[1]}, ${endX} ${endY}`);
  }

  pathCommands.push("Z");
  return pathCommands.join(" ");
}

function star(
  n: number,
  Ro: number,
  Ri: number,
  rot: number,
  roundness = 0.2,
  cx = 12,
  cy = 12
): string {
  roundness /= 10;
  const points: Array<[number, number]> = [];
  const totalPoints = n * 2;

  for (let i = 0; i < totalPoints; i++) {
    const a = ((rot + (180 / n) * i) * Math.PI) / 180;
    const R = i % 2 === 0 ? Ro : Ri;
    points.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }

  let path = "";

  for (let i = 0; i < totalPoints; i++) {
    const prev = points[(i - 1 + totalPoints) % totalPoints]!;
    const curr = points[i]!;
    const next = points[(i + 1) % totalPoints]!;

    const cp1x = curr[0] + roundness * (prev[0] - curr[0]);
    const cp1y = curr[1] + roundness * (prev[1] - curr[1]);
    const cp2x = curr[0] + roundness * (next[0] - curr[0]);
    const cp2y = curr[1] + roundness * (next[1] - curr[1]);

    if (i === 0) {
      path += `M ${cp1x},${cp1y} `;
    }

    path += `L ${cp1x},${cp1y} Q ${curr[0]},${curr[1]} ${cp2x},${cp2y} `;
  }

  return path + "Z";
}

type Shape =
  | { poly: string }
  | { path: string }
  | { rect: { x: number; y: number; w: number; h: number; rx: number } };

const shapres: Record<string, Shape> = {
  Class: { rect: { x: 1, y: 1, w: 22, h: 22, rx: 12 } }, //
  Interface: { rect: { x: 1, y: 1, w: 22, h: 22, rx: 6 } },
  Property: { path: star(3, 11.6, 9, -90, r) },

  Function: { path: ngon(6, 11.2, -90, r) },
  Namespace: { path: ngon(6, 11.2, 0, r) },
  Module: { path: ngon(8, 11.2, 22.5, r) },
  Enumeration: { path: ngon(5, 11.2, -90, r, 12, 12.9) },
  Reference: { path: ngon(7, 11.2, -90, r, 12, 12.4) },
  Variable: { path: star(5, 11.5, 8.5, 90, r) }, //

  Method: { path: star(4, 9, 12, 45, r) },
  Constructor: { path: star(4, 8.5, 15, -90, r) },
  "Type Alias": { path: ngon(5, 11.2, -90, r) },
  Accessor: { path: star(8, 11.5, 9.4, -90, r) }
};

function shapeMarkup(
  q: string,
  kind: string,
  color: string,
  rx: string
): string {
  const v = `var(${color})`;
  const common =
    `style=${q}fill-opacity:var(--icon-bg-opacity,${fallbackOpacity})${q} ` +
    `fill=${q}${v}${q} stroke=${q}${v}${q} stroke-width=${q}1.5${q} ` +
    `stroke-linejoin=${q}round${q}`;
  const s = shapres[kind];
  if (s && "poly" in s) {
    return `<polygon ${common} points=${q}${s.poly}${q}></polygon>`;
  }
  if (s && "path" in s) {
    return `<path ${common} d=${q}${s.path}${q}></path>`;
  }
  const r =
    s && "rect" in s ? s.rect : { x: 1, y: 1, w: 22, h: 22, rx: Number(rx) };
  return (
    `<rect ${common} x=${q}${r.x}${q} y=${q}${r.y}${q} ` +
    `width=${q}${r.w}${q} height=${q}${r.h}${q} rx=${q}${r.rx}${q}></rect>`
  );
}

const shapePatch = {
  name: "icon-shapes",
  routes: ["/assets/icons.js"],
  type: "script",
  scaffold: "<symbol class=",
  match:
    /<symbol class=(\\?")tsd-kind-icon tsd-no-select\1 viewBox=\1([^"\\]+)\1 aria-label=\1([^"\\]+)\1 id=\1([^"\\]+)\1><rect fill=\1var\(--color-icon-background\)\1 stroke=\1var\((--[\w-]+)\)\1 stroke-width=\1[\d.]+\1 x=\1[\d.]+\1 y=\1[\d.]+\1 width=\1[\d.]+\1 height=\1[\d.]+\1 rx=\1(\d+)\1><\/rect>/,
  transform(
    _m,
    _url,
    q = '"',
    viewBox = "0 0 24 24",
    kind = "",
    id = "",
    color = "",
    rx = "6"
  ) {
    console.log(kind);
    return (
      `<symbol viewBox=${q}${viewBox}${q} aria-label=${q}${kind}${q} id=${q}${id}${q} ` +
      `class=${q}tsd-kind-icon tsd-no-select${q}>` +
      shapeMarkup(q, kind, color, rx)
    );
  },
  once: false
} satisfies StaticPatch;

const letterPatch = {
  name: "icon-letter-size",
  routes: ["/assets/icons.js"],
  type: "script",
  scaffold: "<text fill=",
  match: /<text fill=(\\?")var\(--color-icon-text\)\1 x=/,
  transform(_m, _url, q = '"') {
    return `<text font-size=${q}${letterSize}${q} fill=${q}var(--color-icon-text)${q} x=`;
  },
  once: false
} satisfies StaticPatch;

export default letterSize === null ? [shapePatch] : [shapePatch, letterPatch];
