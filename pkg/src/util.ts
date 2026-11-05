import { createRequire } from "module";

/** logs with an `[httptree]` prefix when the `HTTPTREE_DEBUG` env variable is set */
export const debug = (...args: any[]) => {
  if (typeof process !== "undefined")
    if (process.env?.HTTPTREE_DEBUG) {
      console.log("[httptree]", ...args);
    }
};

/** shitass fucking cjs shit i do in esm to load stuff dynmicall ykkls farkjghakrlgja (i hate this) */
export const _require: NodeJS.Require =
  typeof require !== "undefined"
    ? require
    : (createRequire(import.meta.url) as unknown as NodeJS.Require);

/** @category Misc */
export type Flat<T> = { [K in keyof T]: T[K] } & {};

const fileUnits: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3
};

/**
 * turns a size into bytes
 *
 * accepts a number of bytes or a string with a unit (`b`, `kb`, `mb`, `gb`, 1024 based, any case) like `"512kb"` or `"1.5mb"`
 * a number can be `Infinity` for no limit
 *
 * @param [name] name used in the error message
 * @throws `RangeError` if the size is negative, not a number or not a known format
 */
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
