import { createRequire } from "module";

export const debug = (...args: any[]) => {
  if (typeof process !== "undefined")
    if (process.env?.HTTPTREE_DEBUG) {
      console.log("[httptree]", ...args);
    }
};

export const _require: NodeJS.Require =
  typeof require !== "undefined"
    ? require
    : (createRequire(import.meta.url) as unknown as NodeJS.Require);

export type Flat<T> = { [K in keyof T]: T[K] } & {};

const fileUnits: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3
};

export function parseSize(value: number | string, name = "size"): number {
  if (typeof value === "number") {
    if (value === Infinity) return value;
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`httptree: invalid ${name}: ${value}`);
    }
    return Math.floor(value);
  }

  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(value);
  if (!m) throw new RangeError(`httptree: invalid ${name}: "${value}"`);

  return Math.floor(Number(m[1]) * fileUnits[(m[2] || "b").toLowerCase()]!);
}
