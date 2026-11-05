import { DefaultTheme } from "typedoc";

export function load() {
  const original = DefaultTheme.prototype.getNavigation;
  DefaultTheme.prototype.getNavigation = function (project) {
    const nav = original.call(this, project);
    const walk = (items) => {
      for (const item of items) {
        if (!item.children) continue;
        const loose = item.children.filter((c) => c.text === "Other" && c.children);
        if (loose.length) {
          const rest = item.children.filter((c) => !loose.includes(c));
          item.children = [...loose.flatMap((c) => c.children), ...rest];
        }
        walk(item.children);
      }
    };
    walk(nav);
    return nav;
  };
}
