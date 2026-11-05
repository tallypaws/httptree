import type { StaticPatch } from "@tally.paws/webpatcher";

export default {
  name: "index",
  scaffold: '<use href=',
  match: /<use href="([^"]+)"><\/use>/,
  transform(matched, url, ...groups) {
    console.log(matched, "matched");
    return `<use x="" href="${groups[0]?.replace(/(\.\.)*\/?assets\/icons.svg/, "")}"><\/use>`;
  },
  once: false,
  type: "html"
} satisfies StaticPatch;
