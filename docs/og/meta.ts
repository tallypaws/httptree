import { name, color, repo, ghEmoji, img } from "./config.ts";
import { truncate } from "./pages.ts";
import { emojiFor } from "./shapes.ts";
import type { Page, Signature } from "./types.ts";

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

function clipBytes(s: string, max: number): string {
  if (bytes(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (bytes(out + ch + "...") > max) break;
    out += ch;
  }
  return out.replace(/[\s,;:.-]+$/, "") + "...";
}

const limit = 3000;
const sigMax = 600;

function sigText(sig: Signature): string {
  const out: string[] = [];
  let len = 0;
  for (const line of sig) {
    const t = line.map((tok) => tok.t).join("");
    if (out.length && len + t.length > sigMax) {
      out.push("...");
      break;
    }
    out.push(t);
    len += t.length + 1;
  }
  return out.join("\n");
}

const mdEscape = (s: string): string =>
  s.replace(/([\\`*_~|[\]()<>#-])/g, "\\$1");

export function discordEmbed(page: Page): string | null {
  const accent = parseInt(page.color.replace("#", "") ?? color.slice(1), 16);

  const build = (withSig: boolean) => {
    const button: Record<string, unknown> = {
      type: 2,
      style: 5,
      label: page.sourceUrl ? "Source" : "GitHub",
      url: page.sourceUrl ?? repo
    };
    if (ghEmoji) button.emoji = ghEmoji;
    const lines = [
      `## ${emojiFor(page.kind)} [${mdEscape(page.name)}](${page.url})`
    ];
    if (withSig && page.signature)
      lines.push(`\`\`\`ts\n${sigText(page.signature)}\n\`\`\``);
    lines.push(mdEscape(page.paragraphs.join("\n") || page.summary));
    return {
      component: {
        type: 17,
        accent_color: accent,
        components: [
          { type: 10, content: lines.join("\n") },
          { type: 1, components: [button] }
        ]
      }
    };
  };

  const ser = (o: unknown): string =>
    JSON.stringify(o).replace(/</g, "\\u003c");
  let json = ser(build(true));
  if (bytes(json) > limit) json = ser(build(false));
  return bytes(json) > limit ? null : json;
}

export function headTags(page: Page): string {
  const title = clipBytes(page.title, 70);
  const ogDesc = clipBytes(page.description, 350);
  const alt = truncate(`${page.kindLabel} ${page.name}: ${page.summary}`, 200);
  const type = page.kind === "project" ? "website" : "article";

  const tags = [
    `<meta name="description" content="${esc(page.summary)}"/>`,
    `<link rel="canonical" href="${esc(page.url)}"/>`,
    `<meta name="theme-color" content="${color}"/>`,
    `<meta property="og:site_name" content="${name}"/>`,
    `<meta property="og:type" content="${type}"/>`,
    `<meta property="og:title" content="${esc(title)}"/>`,
    `<meta property="og:description" content="${esc(ogDesc)}"/>`,
    `<meta property="og:url" content="${esc(page.url)}"/>`,
    `<meta property="og:image" content="${esc(page.imageUrl)}"/>`,
    `<meta property="og:image:type" content="image/png"/>`,
    `<meta property="og:image:width" content="${img.width}"/>`,
    `<meta property="og:image:height" content="${img.height}"/>`,
    `<meta property="og:image:alt" content="${esc(alt)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${esc(title)}"/>`,
    `<meta name="twitter:description" content="${esc(ogDesc)}"/>`,
    `<meta name="twitter:image" content="${esc(page.imageUrl)}"/>`,
    `<meta name="twitter:image:alt" content="${esc(alt)}"/>`
  ];

  const embed = discordEmbed(page);
  if (embed)
    tags.push(
      `<script id="discord:component-embed" type="application/json">${embed}</script>`
    );
  return tags.join("\n");
}
