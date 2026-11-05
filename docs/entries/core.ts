/**
 * the heart and soul of this thing
 *
 * contains the router, response helpers, and internal* helpers
 *
 * <small>* meant to be internal but exported for custom setups</small>
 *
 * @module core
 */
export {
  root,
  Router,
  RootRouter,
  type HttpTreeOptions,
  type HttpTreeHandler,
  type HttpTreeMiddleware,
  type HttpTreeWSHandler,
  type HttpTreeWSMiddleware,
  type HttpTreeErrorHandler,
  type HttpTreeUpgradeHandler,
  type HttpTreePrecheck,
  type HttpTreeNext,
  type HttpTreeRoute,
  type HttpTreeMiddlewareEntry,
  type HttpTreeWSMiddlewareEntry,
  type HttpTreeWSRoute,
  type HandlerReturn,
  json,
  text,
  html,
  redirect,
  raw,
  file,
  stream,
  error,
  type TreeResponse,
  createResponse,
  toTreeResponse,
  isTreeResponse,
  responseSymbol,
  TreeRequest,
  type HttpTreeRequest,
  type TreeRequestExtras,
  type BodyConfig,
  type BufferOptions,
  type FormOptions,
  type JSONOptions,
  type TextOptions,
  type ParsedForm,
  type UploadedFile,
  type Size,
  validateSchema,
  type StandardSchemaV1,
  type StandardResult,
  type StandardIssue,
  type InferOutput,
  type Flat,
  sex
} from "../../pkg/src/index.js";
