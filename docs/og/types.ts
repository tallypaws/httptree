export interface Token {
  t: string;
  c: string;
}

export type Signature = Token[][];

export type Colors = Record<string, string>;

export type Kind =
  | "project"
  | "page"
  | "guide"
  | "function"
  | "interface"
  | "class"
  | "type"
  | "variable"
  | "enum"
  | "namespace"
  | "module";

export interface ParsedPage {
  rel: string;
  kind: Kind;
  kindLabel: string;
  name: string;
  title: string;
  pathLabel: string;
  paragraphs: string[];
  description: string;
  summary: string;
  signature: Signature | null;
  sourceUrl: string | null;
}

export interface Page extends ParsedPage {
  colors: Colors;
  color: string;
  slug: string;
  version: string;
  urlPath: string;
  url: string;
  imageUrl: string;
}
