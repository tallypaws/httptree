/**
 * query and params validation for httptree, `req.getQuery()` and `req.getParams()`
 *
 * `@tally.paws/httptree-ext-validate`
 *
 * 
 * ```ts
 * import { json, root } from "@tally.paws/httptree";
 * import { validate } from "@tally.paws/httptree-ext-validate";
 * import { z } from "zod";
 *
 * const tree = root().extend(validate);
 *
 * tree.get("/users", async (req) => {
 *   const { page } = await req.getQuery(z.object({ page: z.coerce.number().default(1) }));
 *   return json({ page });
 * });
 * ```
 *
 * @packageDocumentation
 */

import {
  defineExtension,
  perRequestLazy,
  validateSchema,
  type Extension,
  type InferOutput,
  type StandardSchemaV1
} from "@tally.paws/httptree";

export { validateSchema, type InferOutput, type StandardSchemaV1 };

/** what the {@link validate} extension adds to every request */
export interface ValidateRequest {
  /**
   * the query string as an object, a key sent more than once becomes an array
   *
   * @example
   * ```ts
   * // /search?tag=a&tag=b&q=hi
   * req.getQuery(); // { tag: ["a", "b"], q: "hi" }
   * ```
   */
  getQuery(): Record<string, string | string[]>;
  /**
   * the query string checked with a schema, a mismatch answers with a `422` listing the issues
   *
   * values are strings, use `z.coerce.number()` and similar for the rest
   *
   * @example
   * ```ts
   * const { page } = await req.getQuery(z.object({ page: z.coerce.number().default(1) }));
   * ```
   */
  getQuery<S extends StandardSchemaV1>(schema: S): Promise<InferOutput<S>>;
  /**
   * the route params checked with a schema, a mismatch answers with a `422` listing the issues
   *
   * @example
   * ```ts
   * const { id } = await req.getParams(z.object({ id: z.coerce.number().int() }));
   * ```
   */
  getParams<S extends StandardSchemaV1>(schema: S): Promise<InferOutput<S>>;
}

const query = perRequestLazy<Record<string, string | string[]>>((req) => {
  const entries = new Map<string, string | string[]>();
  const search = new URL(req.url ?? "/", "http://localhost").searchParams;
  for (const [key, value] of search) {
    const prev = entries.get(key);
    if (prev === undefined) entries.set(key, value);
    else if (Array.isArray(prev)) prev.push(value);
    else entries.set(key, [prev, value]);
  }
  return Object.fromEntries(entries);
});

/**
 * query and params validation for any [Standard Schema](https://standardschema.dev) library, see {@link ValidateRequest}
 *
 * @example
 * ```ts
 * const tree = root().extend(validate);
 *
 * tree.get("/users", async (req) => {
 *   const { page } = await req.getQuery(z.object({ page: z.coerce.number().default(1) }));
 *   return json({ page });
 * });
 * ```
 */
export const validate: Extension<ValidateRequest> =
  defineExtension<ValidateRequest>({
    name: "validate",
    request: {
      getQuery(schema?: StandardSchemaV1): any {
        const value = query.get(this);
        return schema ? validateSchema(schema, value) : value;
      },
      getParams(schema: StandardSchemaV1): any {
        return validateSchema(schema, this.params);
      }
    }
  });
