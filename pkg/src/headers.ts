/**
 * case insensitive helpers for the `headers` of a response, handy when writing extensions
 *
 * @packageDocumentation
 */

/**
 * the plain `headers` object of a {@link core!TreeResponse | TreeResponse}
 *
 * > [!WARNING]
 * > header names are case insensitive but this is a normal record, so `"Set-Cookie"` and `"set-cookie"` are two keys and the second overwrites the first when finalized
 * > use {@link getHeader}, {@link setHeader} and the rest instead of setting this manually
 */
export type ResponseHeaders = Record<string, string | string[]>;

function keyOf(headers: ResponseHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return k;
  }
  return undefined;
}

/**
 * reads a header, ignoring case
 *
 * @returns the value, an array if it was set more than once (`Set-Cookie`), `undefined` if not set
 */
export function getHeader(
  headers: ResponseHeaders,
  name: string
): string | string[] | undefined {
  const k = keyOf(headers, name);
  return k === undefined ? undefined : headers[k];
}

/** `true` if the header exists, ignoring case */
export function hasHeader(headers: ResponseHeaders, name: string): boolean {
  return keyOf(headers, name) !== undefined;
}

/** sets a header and replaces any existing one, ignoring case */
export function setHeader(
  headers: ResponseHeaders,
  name: string,
  value: string | string[]
): void {
  const k = keyOf(headers, name);
  if (k !== undefined && k !== name) delete headers[k];
  headers[name] = value;
}

/** removes a header, ignoring case */
export function deleteHeader(headers: ResponseHeaders, name: string): void {
  const k = keyOf(headers, name);
  if (k !== undefined) delete headers[k];
}

/**
 * adds a value to a header without replacing what's there, ignoring case
 *
 * for headers that can repeat (`Set-Cookie`) the result is an array
 */
export function appendHeader(
  headers: ResponseHeaders,
  name: string,
  value: string | string[]
): void {
  const k = keyOf(headers, name);
  const add = Array.isArray(value) ? value : [value];
  if (k === undefined) {
    headers[name] = add.length === 1 ? add[0]! : add;
    return;
  }
  const prev = headers[k]!;
  headers[k] = [...(Array.isArray(prev) ? prev : [prev]), ...add];
}

/**
 * adds a field to `Vary` if its not there yet
 *
 * use it when a response changes based on a request header (`Origin`, `Accept-Encoding`), caches need to know
 */
export function addVary(headers: ResponseHeaders, field: string): void {
  const k = keyOf(headers, "vary");
  if (k === undefined) {
    headers["Vary"] = field;
    return;
  }
  const prev = headers[k]!;
  const current = (Array.isArray(prev) ? prev.join(",") : prev)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (current.includes("*")) return;
  if (current.some((s) => s.toLowerCase() === field.toLowerCase())) return;
  headers[k] = [...current, field].join(", ");
}
