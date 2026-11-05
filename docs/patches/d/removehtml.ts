const hasScheme = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const htmlPath = /^([^?#]*?)\.html(?=[?#]|$)/i;

function strip(href: string | null): string {
  if (!href) return href ?? "";
  const value = href.trim();
  if (!value || value.startsWith("#") || hasScheme.test(value)) return href;
  return value.replace(htmlPath, "$1");
}

export default {
  name: "strip-html",
  run(ctx) {
    ctx.patchAttribute("a[href]", "href", (current) => strip(current));
  }
} satisfies DynamicPatch;
