const storage = "tsd-theme";
const buttonId = "toggletheme";

const sun =
  '<svg class="sun" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><g fill="var(--color-icon-text)"><circle cx="8" cy="8" r="3.25"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(0 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(45 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(90 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(135 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(180 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(225 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(270 8 8)"/><rect x="7.25" y="0.75" width="1.5" height="2.25" rx="0.75" transform="rotate(315 8 8)"/></g></svg>';
const moon =
  '<svg class="moon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path fill="var(--color-icon-text)" d="M6.2 1.2A6.8 6.8 0 1 0 14.8 9.8 6.5 6.5 0 0 1 6.2 1.2Z"/></svg>';

const css = `
#${buttonId} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  padding: 0;
  border: 0;
  padding-bottom: 3px;
  background: none;
}
#${buttonId}:focus-visible {
  outline: 2px solid var(--color-accent, currentColor);
  outline-offset: -4px;
}
#${buttonId} svg { display: block; }
#${buttonId}[data-resolved="dark"] .moon,
#${buttonId}[data-resolved="light"] .sun { display: none; }
`;

const dark = window.matchMedia("(prefers-color-scheme: dark)");

type Resolved = "light" | "dark";

function resolve(): Resolved {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  return dark.matches ? "dark" : "light";
}

function apply(theme: Resolved) {
  try {
    localStorage.setItem(storage, theme);
  } catch {}
  document.documentElement.dataset.theme = theme;

  const select = document.getElementById(
    "tsd-theme"
  ) as HTMLSelectElement | null;
  if (select) {
    select.value = theme;
    select.dispatchEvent(new Event("change"));
  }
}

function render(button: HTMLButtonElement) {
  const current = resolve();
  const next: Resolved = current === "dark" ? "light" : "dark";
  button.dataset.resolved = current;
  button.title = `Switch to ${next} theme`;
  button.setAttribute("aria-label", button.title);
}

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = buttonId;
  button.type = "button";
  button.className = "tsd-widget";
  button.innerHTML = sun + moon;
  button.addEventListener("click", () => {
    apply(resolve() === "dark" ? "light" : "dark");
    render(button);
  });
  render(button);
  return button;
}

export default {
  name: "theme-toggle",
  run(ctx) {
    ctx.injectStyle(css, { id: `${buttonId}-style` });
    ctx.hideElement(".tsd-theme-toggle");

    const button = createButton();
    ctx.insertAdjacentElement("#tsd-search-trigger", "afterend", button);

    ctx.onAttributeChange("html", "data-theme", () => render(button));

    const onSystemChange = () => render(button);
    dark.addEventListener("change", onSystemChange);
    ctx.onCleanup(() => dark.removeEventListener("change", onSystemChange));
  }
} satisfies DynamicPatch;
