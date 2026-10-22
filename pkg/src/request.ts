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
  type JSONOptions,
  type ParsedForm,
  type TextOptions,
  type UploadedFile,
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

export interface TreeRequestExtras {
  data: Record<string, any>;

  sentResponse(): boolean;
  isError(): boolean;
  readonly error: unknown;
  response: TreeResponse | undefined;

  getBuffer(opts?: BufferOptions): Promise<Buffer>;
  getText(opts?: TextOptions): Promise<string>;
  getJSON<T = unknown>(
    opts: JSONOptions<T> & { allowEmpty: true },
  ): Promise<T | undefined>;
  getJSON<T = unknown>(opts?: JSONOptions<T>): Promise<T>;
  getForm(opts?: FormOptions): Promise<ParsedForm>;
  getFile(field?: string, opts?: FormOptions): Promise<UploadedFile | undefined>;
  getFiles(field?: string, opts?: FormOptions): Promise<UploadedFile[]>;
}

export type HttpTreeRequest<P = Record<string, string | string[]>> =
  http.IncomingMessage & TreeRequestExtras & { params: Flat<P> };

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
    return field === undefined ? files[0] : files.find((f) => f.field === field);
  }

  async getFiles(field?: string, opts?: FormOptions) {
    const { files } = await this.getForm(opts);
    return field === undefined ? files : files.filter((f) => f.field === field);
  }
}

export function ensureTreeRequest(req: http.IncomingMessage): TreeRequest {
  if (!(req instanceof TreeRequest)) {
    Object.setPrototypeOf(req, TreeRequest.prototype);
  }
  const r = req as TreeRequest;
  if (!r.params) r.params = {};
  if (!r.data) r.data = {};
  return r;
}
