import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { loadColors, kindColor } from "../og/colors.ts";
import { shapeFor, letterFor } from "../og/shapes.ts";
import type { Kind } from "../og/types.ts";

const kinds: Kind[] = [
  "function",
  "interface",
  "class",
  "type",
  "enum",
  "namespace",
  "module",
  "variable"
];
const size = Number(process.argv[3]) || 512;
const out = path.resolve(process.argv[2] ?? "shapes");
const colors = loadColors(path.resolve(import.meta.dirname, "../generated"));
const nunito = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@fontsource/nunito/package.json")),
  "files"
);
const fonts = [
  {
    name: "Nunito",
    weight: 800 as const,
    style: "normal" as const,
    data: fs.readFileSync(path.join(nunito, "nunito-latin-800-normal.woff"))
  }
];

fs.mkdirSync(out, { recursive: true });
for (const kind of kinds) {
  const color = kindColor(colors, kind);
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          position: "relative",
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center"
        },
        children: [
          {
            type: "svg",
            props: {
              width: size,
              height: size,
              viewBox: "0 0 24 24",
              style: { position: "absolute", left: 0, top: 0 },
              children: [
                {
                  type: "path",
                  props: {
                    d: shapeFor(kind),
                    fill: color,
                    "fill-opacity": 0.2,
                    stroke: color,
                    "stroke-width": 1.5,
                    "stroke-linejoin": "round"
                  }
                }
              ]
            }
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                fontFamily: "Nunito",
                fontWeight: 800,
                fontSize: (size * 38) / 66,
                color
              },
              children: letterFor(kind)
            }
          }
        ]
      }
    },
    { width: size, height: size, fonts }
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();
  fs.writeFileSync(path.join(out, `${kind}.png`), png);
  console.log(`${kind}.png`);
}
