import * as http from "http";
import { debug, type Flat } from "./util.js";
import type { TreeResponse } from "./response.js";
import {
  readBuffer,
  readForm,
  readJSON,
  readText,
  type BodyConfig,
  type BodyState,
  type BufferOptions,
  type FormOptions,
  type InferOutput,
  type JSONOptions,
  type ParsedForm,
  type StandardSchemaV1,
  type TextOptions,
  type UploadedFile
} from "./body.js";

export interface RequestState extends BodyState {
  root?: { bodyConfig: BodyConfig };
  res?: http.ServerResponse;
  response?: TreeResponse;
  error?: unknown;
}

const stateSymbol = Symbol("httptree.state");

export function stateOf(req: http.IncomingMessage): RequestState {
  let st = (req as any)[stateSymbol] as RequestState | undefined;
  if (!st) {
    st = {};
    Object.defineProperty(req, stateSymbol, { value: st, enumerable: false });
  }
  return st;
}

const configOf = (st: RequestState): BodyConfig => st.root?.bodyConfig ?? {};

/**
 * the extra stuff httptree adds to node's `IncomingMessage`, see {@link HttpTreeRequest}
 *
 * body reading is cached, calling a getter twice is fine
 * going over a size limit responds with a `413`, see {@link BodyConfig}
 */
export interface TreeRequestExtras {
  /** Untyped space for passing values between middleware and handlers
   *
   * Better system is planned haha i know this is bad
   */
  data: Record<string, any>;

  /** `true` once a response is sent */
  sentResponse(): boolean;
  /** `true` if something was thrown or the response status is 4xx or 5xx */
  isError(): boolean;
  /** what was thrown during this request */
  readonly error: unknown;
  /** the response that will be sent, read, replace or delete it from middleware*/
  response: TreeResponse | undefined;

  /**
   * reads the whole body as a `Buffer`
   */
  getBuffer(opts?: BufferOptions): Promise<Buffer>;
  /**
   * reads the body as text, decoded with `opts.encoding`, else the charset of the `Content-Type` header, else `utf-8`
   */
  getText(opts?: TextOptions): Promise<string>;
  /**
   * reads the body as JSON and checks it with a [Standard Schema](https://standardschema.dev), an empty body resolves to `undefined`
   */
  getJSON<S extends StandardSchemaV1>(
    opts: JSONOptions & { schema: S; allowEmpty: true }
  ): Promise<InferOutput<S> | undefined>;
  /**
   * reads the body as JSON and checks it with a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype...)
   *
   * fails with a `415` if the `Content-Type` isnt JSON, a `400` if the body is empty or invalid and a `422` with the issues if the schema doesnt match
   *
   * @example
   * ```ts
   * const user = await req.getJSON({ schema: z.object({ name: z.string() }) });
   * ```
   */
  getJSON<S extends StandardSchemaV1>(
    opts: JSONOptions & { schema: S }
  ): Promise<InferOutput<S>>;
  /**
   * reads the body as JSON, an empty body resolves to `undefined` instead of failing with a `400`
   *
   * @example
   * ```ts
   * const body = await req.getJSON<{ name?: string }>({ allowEmpty: true });
   * ```
   */
  getJSON<T = unknown>(
    opts: JSONOptions<T> & { allowEmpty: true }
  ): Promise<T | undefined>;
  /**
   * reads the body as JSON
   *
   * fails with a `415` if the `Content-Type` is not JSON, a `400` if the body is empty or invalid and a `422` if `validate` throws
   *
   * > [!WARNING]
   * > the type you pass is not checked, use `validate` for that
   *
   * @example
   * ```ts
   * const body = await req.getJSON<{ message: string }>();
   *
   * // validated (zod, valibot, etc)
   * const user = await req.getJSON({ validate: (v) => userSchema.parse(v) });
   * ```
   */
  getJSON<T = unknown>(opts?: JSONOptions<T>): Promise<T>;
  /**
   * reads a `multipart/form-data` or `application/x-www-form-urlencoded` body
   * multipart needs the `busboy` package
   *
   * > [!WARNING]
   * > multipart eats the body, so dont mix it with the other getters
   *
   * @example
   * ```ts
   * const { fields, files } = await req.getForm();
   * ```
   */
  getForm(opts?: FormOptions): Promise<ParsedForm>;
  /**
   * gets one uploaded file, the first one or the first from `field`
   */
  getFile(
    field?: string,
    opts?: FormOptions
  ): Promise<UploadedFile | undefined>;
  /**
   * gets the uploaded files, all of them or only the ones from `field`
   */
  getFiles(field?: string, opts?: FormOptions): Promise<UploadedFile[]>;
}

/**
 * node's `IncomingMessage` with {@link TreeRequestExtras} and typed `params`
 *
 * @typeParam P the route params
 * @typeParam X what extensions add to the request
 * @typeParam D the type of `req.data`
 */
export type HttpTreeRequest<
  P = Record<string, string | string[]>,
  X extends object = {},
  D extends object = {}
> = http.IncomingMessage &
  TreeRequestExtras &
  X & { params: Flat<P>; data: Flat<D> };

/**
 * node's `IncomingMessage` class with {@link TreeRequestExtras} on top
 */
export class TreeRequest
  extends http.IncomingMessage
  implements TreeRequestExtras
{
  declare params: Record<string, any>;
  declare data: Record<string, any>;

  sentResponse(): boolean {
    const st = stateOf(this);
    if (st.response) return true;
    return !!st.res && (st.res.headersSent || st.res.writableEnded);
  }

  isError(): boolean {
    const st = stateOf(this);
    if (st.error !== undefined) return true;
    if (st.response) return st.response.status >= 400;
    return !!st.res && st.res.headersSent && st.res.statusCode >= 400;
  }

  get error(): unknown {
    return stateOf(this).error;
  }

  get response(): TreeResponse | undefined {
    return stateOf(this).response;
  }

  set response(value: TreeResponse | undefined) {
    const st = stateOf(this);
    if (value && st.res && (st.res.headersSent || st.res.writableEnded)) {
      debug("ignoring req.response the response was already sent");
      return;
    }
    st.response = value;
  }

  getBuffer(opts?: BufferOptions) {
    const st = stateOf(this);
    return readBuffer(this, st, configOf(st), opts);
  }

  getText(opts?: TextOptions) {
    const st = stateOf(this);
    return readText(this, st, configOf(st), opts);
  }

  getJSON<T = unknown>(opts?: JSONOptions<T>): Promise<any> {
    const st = stateOf(this);
    return readJSON<T>(this, st, configOf(st), opts);
  }

  getForm(opts?: FormOptions) {
    const st = stateOf(this);
    return readForm(this, st, configOf(st), opts);
  }

  async getFile(field?: string, opts?: FormOptions) {
    const { files } = await this.getForm(opts);
    return field === undefined
      ? files[0]
      : files.find((f) => f.field === field);
  }

  async getFiles(field?: string, opts?: FormOptions) {
    const { files } = await this.getForm(opts);
    return field === undefined ? files : files.filter((f) => f.field === field);
  }
}

/**
 * turns a plain node request into a {@link TreeRequest} in place
 *
 * @returns the same request, as a `TreeRequest`
 */
export function ensureTreeRequest(
  req: http.IncomingMessage,
  proto: object = TreeRequest.prototype
): TreeRequest {
  if (Object.getPrototypeOf(req) !== proto) {
    Object.setPrototypeOf(req, proto);
  }
  const r = req as TreeRequest;
  if (!r.params) r.params = {};
  if (!r.data) r.data = {};
  return r;
}
