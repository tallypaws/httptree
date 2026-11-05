import type { StaticPatch } from "@tally.paws/webpatcher";
import path from "node:path";
import { createPages } from "../og/pages.ts";
import { headTags } from "../og/meta.ts";


const pages = createPages({
  generatedDir: path.resolve(import.meta.dirname, "../generated"),
  ogDir: path.resolve(import.meta.dirname, "../og")
});

export default {
  name: "seo",
  scaffold: '<meta name="description"',
  match: /<meta name="description"[^>]*>/,
  type: "html",
  transform(matched, url) {
    try {
      const page = pages.get(url);
      return page ? headTags(page) : matched;
    } catch (err) {
      console.error(`seo patch failed for ${url}:`, err);
      return matched;
    }
  }
} satisfies StaticPatch;
