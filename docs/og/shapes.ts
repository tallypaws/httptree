import type { Kind } from "./types.ts";

type Pt = [number, number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const R = 3;

function ngon(
  n: number,
  Ro: number,
  rot: number,
  r: number,
  cx = 12,
  cy = 12
): string {
  const v: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    v.push([cx + Ro * Math.cos(a), cy + Ro * Math.sin(a)]);
  }
  const cmds = [];
  for (let i = 0; i < n; i++) {
    const prev = v[(i - 1 + n) % n]!;
    const cur = v[i]!;
    const next = v[(i + 1) % n]!;
    const lp = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]);
    const ln = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const cr = Math.min(r, Math.min(lp, ln) / 2);
    const sx = cur[0] + ((prev[0] - cur[0]) / lp) * cr;
    const sy = cur[1] + ((prev[1] - cur[1]) / lp) * cr;
    const ex = cur[0] + ((next[0] - cur[0]) / ln) * cr;
    const ey = cur[1] + ((next[1] - cur[1]) / ln) * cr;
    cmds.push(
      `${i === 0 ? "M" : "L"} ${r2(sx)} ${r2(sy)}`,
      `Q ${r2(cur[0])} ${r2(cur[1])}, ${r2(ex)} ${r2(ey)}`
    );
  }
  cmds.push("Z");
  return cmds.join(" ");
}

function rect(rx: number): string {
  const x = 1,
    y = 1,
    s = 22;
  return `M ${x + rx} ${y} H ${x + s - rx} Q ${x + s} ${y} ${x + s} ${y + rx} V ${y + s - rx} Q ${x + s} ${y + s} ${x + s - rx} ${y + s} H ${x + rx} Q ${x} ${y + s} ${x} ${y + s - rx} V ${y + rx} Q ${x} ${y} ${x + rx} ${y} Z`;
}

const shapes: Record<string, string> = {
  function: ngon(6, 11.2, -90, R),
  interface: rect(6),
  class: rect(12),
  type: ngon(5, 11.2, -90, R),
  enum: ngon(5, 11.2, -90, R, 12, 12.9),
  namespace: ngon(6, 11.2, 0, R),
  module: ngon(8, 11.2, 22.5, R),
  variable: starPath(5, 11.5, 8.5, 90, R)
};

function starPath(
  n: number,
  Ro: number,
  Ri: number,
  rot: number,
  roundness: number,
  cx = 12,
  cy = 12
): string {
  roundness /= 10;
  const pts: Pt[] = [];
  const total = n * 2;
  for (let i = 0; i < total; i++) {
    const a = ((rot + (180 / n) * i) * Math.PI) / 180;
    const rr = i % 2 === 0 ? Ro : Ri;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  let d = "";
  for (let i = 0; i < total; i++) {
    const prev = pts[(i - 1 + total) % total]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % total]!;
    const c1: Pt = [
      cur[0] + roundness * (prev[0] - cur[0]),
      cur[1] + roundness * (prev[1] - cur[1])
    ];
    const c2: Pt = [
      cur[0] + roundness * (next[0] - cur[0]),
      cur[1] + roundness * (next[1] - cur[1])
    ];
    if (i === 0) d += `M ${r2(c1[0])},${r2(c1[1])} `;
    d += `L ${r2(c1[0])},${r2(c1[1])} Q ${r2(cur[0])},${r2(cur[1])} ${r2(c2[0])},${r2(c2[1])} `;
  }
  return d + "Z";
}
``
const letters: Record<string, string> = {
  function: "F",
  interface: "I",
  class: "C",
  type: "T",
  enum: "E",
  namespace: "N",
  module: "M",
  variable: "V"
};

/** 
 * <:class:1567796725995929680>
 * <:enum:1567796724364222524>
 * <:function:1567796722950873258>
 * <:interface:1567796706735685652>
 * <:module:1567796701631348796>
 * <:namespace:1567796704508645466>
 * <:type:1567796702818209882>
 * <:variable:1567796619166875688> 
 */

const emojis: Record<string, string> = {
  function: "<:function:1567796722950873258>",
  interface: "<:interface:1567796706735685652>",
  class: "<:class:1567796725995929680>",
  type: "<:type:1567796702818209882>",
  enum: "<:enum:1567796724364222524>",
  namespace: "<:namespace:1567796704508645466>",
  module: "<:module:1567796701631348796>",
  variable: "<:variable:1567796619166875688>",
};

export const shapeFor = (kind: Kind): string => shapes[kind] ?? shapes.module!;
export const letterFor = (kind: Kind): string =>
  letters[kind] ?? (kind === "guide" ? "G" : "D");
export const emojiFor = (kind: Kind): string => emojis[kind] ?? "";
