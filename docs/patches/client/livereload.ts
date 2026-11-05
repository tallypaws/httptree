const endpoint = "/__live";
const retryAfter = 300;
const MaxAttempts = 40;

const get = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" });

async function problem(): Promise<string | null> {
  let res: Response;
  try {
    res = await get(location.href);
  } catch (err) {
    return `page request failed (${(err as Error).message})`;
  }
  if (!res.ok) return `page returned ${res.status}`;
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) {
    return `page is not html (${res.headers.get("content-type")})`;
  }

  const html = await res.text();
  if (!/<\/html\s*>/i.test(html))
    return "page is not complete";

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.body || doc.body.childNodes.length === 0)
    return "page body is empty";

  const refs = new Set<string>();
  const add = (value: string | null) => {
    if (!value || /^(?:data|blob|javascript|mailto|about):/i.test(value))
      return;
    const u = new URL(value, location.href);
    if (u.origin !== location.origin || u.pathname === endpoint) return;
    u.hash = "";
    refs.add(u.href);
  };
  doc
    .querySelectorAll("script[src]")
    .forEach((el) => add(el.getAttribute("src")));
  doc
    .querySelectorAll(
      'link[rel~="stylesheet"][href], link[rel~="modulepreload"][href]'
    )
    .forEach((el) => add(el.getAttribute("href")));

  const results = await Promise.all(
    [...refs].map(async (href) => {
      try {
        const r = await get(href);
        await r.arrayBuffer();
        return r.ok ? null : `${new URL(href).pathname} returned ${r.status}`;
      } catch (err) {
        return `${new URL(href).pathname} failed (${(err as Error).message})`;
      }
    })
  );
  return results.find((r) => r !== null) ?? null;
}

export default {
  name: "livereload",
  run(ctx) {
    const es = new EventSource(endpoint);
    let wasDown = false;
    let checking = false;
    let again = false;
    let stopped = false;

    async function reloadWhenSafe(): Promise<void> {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      try {
        do {
          again = false;
          let reason: string | null = "not checked";
          for (
            let attempt = 1;
            attempt <= MaxAttempts && !again && !stopped;
            attempt++
          ) {
            reason = await problem();
            if (reason === null) break;
            await new Promise((r) => setTimeout(r, retryAfter));
          }
          if (again) continue;
          if (reason === null && !stopped) {
            location.reload();
            return;
          }
          if (reason !== null) {
            console.warn(
              `[livereload] not reloading, page is broken: ${reason}`
            );
          }
        } while (again);
      } finally {
        checking = false;
      }
    }

    es.onmessage = (e) => {
      const { paths } = JSON.parse(e.data) as { paths: string[] };
      void reloadWhenSafe();
    };

    es.onerror = () => {
      wasDown = true;
    };
    es.onopen = () => {
      if (wasDown) {
        wasDown = false;
        void reloadWhenSafe();
      }
    };

    ctx.onCleanup(() => {
      stopped = true;
      es.close();
    });
  }
} satisfies DynamicPatch;
