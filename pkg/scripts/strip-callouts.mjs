import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = process.argv[2]
  ? resolve(process.argv[2])
  : new URL("../dist", import.meta.url).pathname;

 const marker = /^(\s*\*\s?)> \[!(\w+)\]\s*$/;
 const quoted = /^\s*\*\s?>\s?(.*)$/;

function strip(text) {
  const lines = text.split("\n");
  const out = [];

  const markerRegex = /^(\s*\*\s?)> \[!(\w+)\]\s*$/;
  const quoteRegex = /^\s*\*\s?>\s?(.*)$/;
  const categoryRegex = /^\s*\*?\s*@category\b/;

  for (let i = 0; i < lines.length; i++) {
    if (categoryRegex.test(lines[i])) {
      continue;
    }

    const markerMatch = markerRegex.exec(lines[i]);

    if (!markerMatch) {
      out.push(lines[i]);
      continue;
    }

    const [, prefix, kind] = markerMatch;
    let isFirstLine = true;

    while (i + 1 < lines.length && quoteRegex.test(lines[i + 1])) {
      i++;

      if (categoryRegex.test(lines[i])) {
        continue;
      }

      const body = quoteRegex.exec(lines[i])[1];

      if (isFirstLine) {
        out.push(`${prefix}${kind.toLowerCase()}: ${body}`);
        isFirstLine = false;
      } else {
        out.push(`${prefix}${body}`);
      }
    }
  }

  return out.join("\n");
}


function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|mjs|cjs|d\.ts|d\.mts|d\.cts)$/.test(name)) {
      const before = readFileSync(path, "utf8");
      const after = strip(before);
      if (after !== before) writeFileSync(path, after);
    }
  }
}

walk(dist);
