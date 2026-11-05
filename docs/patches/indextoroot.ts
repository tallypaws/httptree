import type { StaticPatch } from "@tally.paws/webpatcher";

export default {
  name: "index",
  scaffold: '<a href="',
  match: /<a href="(\.\.\/)\/?index.html"/,
  transform(matched, url, ...groups) {
    console.log(matched, "matched");
    return '<a href="/"';
  },
  once: false,
  
  type: "html"
} satisfies StaticPatch;
