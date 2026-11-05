export function galleryHtml(urls: string[], query = ""): string {
  const q = query.toLowerCase();
  const shown = urls.filter((u) => u.toLowerCase().includes(q));
  const cell = (u: string): string => {
    const slug = u === "/" ? "index" : u.slice(1);
    return `<img loading="lazy" width="600" height="315" src="/_og/${slug}.png"/>`;
  };
  return /*html*/ `
  <!doctype html>
    <html>
      <head>
        <style>
          body { margin: 0; padding: 24px; background: #121214; color: #c8c5d0; font: 14px system-ui, sans-serif; }
          form { margin-bottom: 20px; }
          input { background: #1c1b1f; color: inherit; border: 1px solid #47464f; border-radius: 8px; padding: 8px 12px; width: 280px; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
          img { width: 100%; height: auto; aspect-ratio: 1200 / 630; border-radius: 10px; background: #1c1b1f; }
          span { font-family: ui-monospace, monospace; color: #918f9a; }
        </style>
      </head>
    <body>
      <div class="grid">${shown.map(cell).join("\n")}</div>
      <script>
        let last = null;
        setInterval(async () => {
          try {
            const s = await (await fetch("/_og/__stamp", { cache: "no-store" })).text();
            if (last !== null && s !== last) {
              document.querySelectorAll("img").forEach((img) => {
                img.src = img.src.split("?")[0] + "?t=" + Date.now();
              });
            }
            last = s;
          } catch {}
        }, 1000);
      </script>
    </body>
  </html>
`;
}
