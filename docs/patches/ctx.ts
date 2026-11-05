export function createPatchContext(pathname: string): PatchContext {
  const cleanupFns: Array<() => void> = [];

  function makeDisposable(fn: () => void): Disposable {
    let done = false;
    return {
      dispose() {
        if (done) return;
        done = true;
        fn();
      },
      [Symbol.dispose]: () => {
        if (done) return;
        done = true;
        fn();
      },
    };
  }

  function track<D extends Disposable>(d: D): D {
    cleanupFns.push(() => d.dispose());
    return d;
  }

  function $<T extends Element = Element>(
    selector: string,
    root: ParentNode = document,
  ): T | null {
    return root.querySelector<T>(selector);
  }

  function $$<T extends Element = Element>(
    selector: string,
    root: ParentNode = document,
  ): T[] {
    return Array.from(root.querySelectorAll<T>(selector));
  }

  function waitForElement<T extends Element = Element>(
    selector: string,
    options: WaitOptions = {},
  ): Promise<T> {
    const { timeout = 5000, root = document } = options;
    return new Promise<T>((resolve, reject) => {
      const immediate = (root as ParentNode).querySelector<T>(selector);
      if (immediate) {
        resolve(immediate);
        return;
      }

      let timer: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        const el = (root as ParentNode).querySelector<T>(selector);
        if (!el) return;
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        resolve(el);
      });
      observer.observe(root, { childList: true, subtree: true });

      if (timeout > 0) {
        timer = setTimeout(() => {
          observer.disconnect();
          reject(
            new Error(
              `[webpatcher] waitForElement("${selector}") timed out after ${timeout}ms`,
            ),
          );
        }, timeout);
      }
    });
  }

  function waitForElements<T extends Element = Element>(
    selector: string,
    options: WaitOptions & { count?: number } = {},
  ): Promise<T[]> {
    const { timeout = 5000, root = document, count = 1 } = options;
    return new Promise<T[]>((resolve, reject) => {
      const check = (): T[] | null => {
        const els = Array.from(
          (root as ParentNode).querySelectorAll<T>(selector),
        );
        return els.length >= count ? els : null;
      };

      const immediate = check();
      if (immediate) {
        resolve(immediate);
        return;
      }

      let timer: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        const els = check();
        if (!els) return;
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        resolve(els);
      });
      observer.observe(root, { childList: true, subtree: true });

      if (timeout > 0) {
        timer = setTimeout(() => {
          observer.disconnect();
          reject(
            new Error(
              `[webpatcher] waitForElements("${selector}", { count: ${count} }) timed out after ${timeout}ms`,
            ),
          );
        }, timeout);
      }
    });
  }

  function waitForElementWithText<T extends Element = Element>(
    selector: string,
    text: string | RegExp,
    options: WaitOptions = {},
  ): Promise<T> {
    const { timeout = 5000, root = document } = options;
    const matchesText = (el: Element): boolean =>
      text instanceof RegExp
        ? text.test(el.textContent ?? "")
        : (el.textContent ?? "").includes(text);

    return new Promise<T>((resolve, reject) => {
      const check = (): T | null =>
        Array.from((root as ParentNode).querySelectorAll<T>(selector)).find(
          matchesText,
        ) ?? null;

      const immediate = check();
      if (immediate) {
        resolve(immediate);
        return;
      }

      let timer: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        const el = check();
        if (!el) return;
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        resolve(el);
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      if (timeout > 0) {
        timer = setTimeout(() => {
          observer.disconnect();
          reject(
            new Error(
              `[webpatcher] waitForElementWithText("${selector}", ...) timed out after ${timeout}ms`,
            ),
          );
        }, timeout);
      }
    });
  }

  function onElementAdded<T extends Element = Element>(
    selector: string,
    callback: (el: T) => void,
    options: ObserveOptions = {},
  ): Disposable {
    const { root = document, subtree = true } = options;

    (root as ParentNode).querySelectorAll<T>(selector).forEach(callback);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (el.matches(selector)) callback(el as T);
          el.querySelectorAll<T>(selector).forEach(callback);
        }
      }
    });

    observer.observe(root, { childList: true, subtree });
    return track(makeDisposable(() => observer.disconnect()));
  }

  function onElementRemoved<T extends Element = Element>(
    selector: string,
    callback: (el: T) => void,
    options: ObserveOptions = {},
  ): Disposable {
    const { root = document, subtree = true } = options;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.removedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (el.matches(selector)) callback(el as T);
          el.querySelectorAll<T>(selector).forEach(callback);
        }
      }
    });

    observer.observe(root, { childList: true, subtree });
    return track(makeDisposable(() => observer.disconnect()));
  }

  function onElementModified<T extends Element = Element>(
    selector: string,
    callback: (el: T, mutation: MutationRecord) => void,
    options: ModifyObserveOptions = {},
  ): Disposable {
    const {
      root = document,
      subtree = true,
      attributes = true,
      childList = true,
      characterData = true,
    } = options;

    const elementObservers = new Map<Element, MutationObserver>();

    function attachToElement(el: T): void {
      if (elementObservers.has(el)) return;
      const obs = new MutationObserver((mutations) => {
        for (const mutation of mutations) callback(el, mutation);
      });
      obs.observe(el, { attributes, childList, characterData, subtree: true });
      elementObservers.set(el, obs);
    }

    (root as ParentNode).querySelectorAll<T>(selector).forEach(attachToElement);

    const addedWatcher = onElementAdded<T>(selector, attachToElement, {
      root,
      subtree,
    });

    return track(
      makeDisposable(() => {
        addedWatcher.dispose();
        elementObservers.forEach((obs) => obs.disconnect());
        elementObservers.clear();
      }),
    );
  }

  function onAttributeChange<T extends Element = Element>(
    selector: string,
    attribute: string | string[],
    callback: (el: T, newValue: string | null, oldValue: string | null) => void,
    options: ObserveOptions = {},
  ): Disposable {
    const { root = document, subtree = true } = options;
    const attrs = Array.isArray(attribute) ? attribute : [attribute];

    const elementObservers = new Map<Element, MutationObserver>();

    function attachToElement(el: T): void {
      if (elementObservers.has(el)) return;
      const obs = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && mutation.attributeName) {
            callback(
              el,
              el.getAttribute(mutation.attributeName),
              mutation.oldValue,
            );
          }
        }
      });
      obs.observe(el, {
        attributes: true,
        attributeFilter: attrs,
        attributeOldValue: true,
      });
      elementObservers.set(el, obs);
    }

    (root as ParentNode).querySelectorAll<T>(selector).forEach(attachToElement);
    const addedWatcher = onElementAdded<T>(selector, attachToElement, {
      root,
      subtree,
    });

    return track(
      makeDisposable(() => {
        addedWatcher.dispose();
        elementObservers.forEach((obs) => obs.disconnect());
        elementObservers.clear();
      }),
    );
  }

  function replaceElement<T extends Element = Element>(
    selector: string,
    factory: (original: T) => Element,
    options: ReplaceOptions = {},
  ): Disposable {
    const { root = document, persistent = true } = options;
    const handled = new WeakSet<Element>();

    function doReplace(el: T): void {
      if (handled.has(el)) return;
      handled.add(el);
      const replacement = factory(el);
      handled.add(replacement);
      el.parentNode?.replaceChild(replacement, el);
    }

    (root as ParentNode).querySelectorAll<T>(selector).forEach(doReplace);

    if (!persistent) return track(makeDisposable(() => {}));

    const watcher = onElementAdded<T>(
      selector,
      (el) => {
        if (!handled.has(el)) doReplace(el);
      },
      { root },
    );

    return track(makeDisposable(() => watcher.dispose()));
  }

  function wrapElement<T extends Element = Element>(
    selector: string,
    wrapperFactory: () => Element,
    options: ReplaceOptions = {},
  ): Disposable {
    return replaceElement<T>(
      selector,
      (original) => {
        const wrapper = wrapperFactory();
        wrapper.appendChild(original.cloneNode(true));
        return wrapper;
      },
      options,
    );
  }

  function patchAttribute(
    selector: string,
    attribute: string,
    value: string | ((current: string | null, el: Element) => string),
    options: ObserveOptions = {},
  ): Disposable {
    const { root = document } = options;
    const getExpected = (current: string | null, el: Element): string =>
      typeof value === "function" ? value(current, el) : value;

    function applyPatch(el: Element): void {
      el.setAttribute(attribute, getExpected(el.getAttribute(attribute), el));
    }

    (root as ParentNode).querySelectorAll(selector).forEach(applyPatch);

    const addedWatcher = onElementAdded(selector, applyPatch, { root });
    const attrWatcher = onAttributeChange(
      selector,
      attribute,
      (el, newVal) => {
        const expected = getExpected(newVal, el);
        if (newVal !== expected) el.setAttribute(attribute, expected);
      },
      { root },
    );

    return track(
      makeDisposable(() => {
        addedWatcher.dispose();
        attrWatcher.dispose();
      }),
    );
  }

  function patchText(
    selector: string,
    replacer: string | RegExp,
    replacement: string | ((match: string, el: Element) => string),
    options: ObserveOptions = {},
  ): Disposable {
    const { root = document } = options;

    function applyPatch(el: Element): void {
      const current = el.textContent ?? "";
      const next =
        typeof replacement === "function"
          ? current.replace(replacer as RegExp, (m) =>
              (replacement as (m: string, el: Element) => string)(m, el),
            )
          : current.replace(replacer, replacement as string);
      if (next !== current) el.textContent = next;
    }

    (root as ParentNode).querySelectorAll(selector).forEach(applyPatch);

    const addedWatcher = onElementAdded(selector, applyPatch, { root });
    const modifiedWatcher = onElementModified(
      selector,
      (el) => applyPatch(el),
      { root, attributes: false, childList: true, characterData: true },
    );

    return track(
      makeDisposable(() => {
        addedWatcher.dispose();
        modifiedWatcher.dispose();
      }),
    );
  }

  function addClass(selector: string, ...classes: string[]): Disposable {
    function applyPatch(el: Element): void {
      el.classList.add(...classes);
    }

    (document as ParentNode).querySelectorAll(selector).forEach(applyPatch);
    const addedWatcher = onElementAdded(selector, applyPatch);

    const attrWatcher = onAttributeChange(selector, "class", (el) => {
      if (!classes.every((c) => el.classList.contains(c))) {
        el.classList.add(...classes);
      }
    });

    return track(
      makeDisposable(() => {
        addedWatcher.dispose();
        attrWatcher.dispose();
      }),
    );
  }

  function removeClass(selector: string, ...classes: string[]): Disposable {
    function applyPatch(el: Element): void {
      el.classList.remove(...classes);
    }

    (document as ParentNode).querySelectorAll(selector).forEach(applyPatch);
    const addedWatcher = onElementAdded(selector, applyPatch);

    const attrWatcher = onAttributeChange(selector, "class", (el) => {
      if (classes.some((c) => el.classList.contains(c))) {
        el.classList.remove(...classes);
      }
    });

    return track(
      makeDisposable(() => {
        addedWatcher.dispose();
        attrWatcher.dispose();
      }),
    );
  }

  function hideElement(selector: string): Disposable {
    return injectStyle(`${selector} { display: none !important; }`, {
      id: `webpatcher-hide-${selector.replace(/\W+/g, "_")}`,
    });
  }

  function injectStyle(css: string, options: StyleOptions = {}): Disposable {
    const { id, prepend = false } = options;

    if (id) document.getElementById(id)?.remove();

    const style = document.createElement("style");
    if (id) style.id = id;
    style.textContent = css;

    if (prepend && document.head.firstChild) {
      document.head.insertBefore(style, document.head.firstChild);
    } else {
      document.head.appendChild(style);
    }

    return track(makeDisposable(() => style.remove()));
  }

  function injectScript(src: string): Promise<Disposable> {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () =>
        resolve(track(makeDisposable(() => script.remove())));
      script.onerror = () =>
        reject(new Error(`[webpatcher] failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  function injectInlineScript(code: string): void {
    const script = document.createElement("script");
    script.textContent = code;
    document.head.appendChild(script);
    script.remove();
  }

  function insertAdjacentElement(
    anchor: string | Element,
    position: InsertPosition,
    el: Element,
    options: ObserveOptions = {},
  ): Disposable {
    const { root = document } = options;

    function doInsert(anchorEl: Element): void {
      anchorEl.insertAdjacentElement(position, el);
    }

    if (typeof anchor !== "string") {
      doInsert(anchor);
      return track(makeDisposable(() => el.remove()));
    }

    const anchorEl = (root as ParentNode).querySelector(anchor);
    if (anchorEl) doInsert(anchorEl);

    const watcher = onElementAdded(anchor, doInsert, { root });

    return track(
      makeDisposable(() => {
        watcher.dispose();
        el.remove();
      }),
    );
  }

  function onCleanup(fn: () => void): void {
    cleanupFns.push(fn);
  }

  function cleanup(): void {
    for (let i = cleanupFns.length - 1; i >= 0; i--) {
      try {
        cleanupFns[i]!();
      } catch (err) {
        console.error("[webpatcher] cleanup error:", err);
      }
    }
    cleanupFns.length = 0;
  }

  function poll<T>(
    fn: () => T | null | undefined | false,
    options: PollOptions = {},
  ): Promise<T> {
    const { interval = 100, timeout = 5000 } = options;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        const result = fn();
        if (result !== null && result !== undefined && result !== false) {
          resolve(result as T);
          return;
        }
        if (timeout > 0 && Date.now() - start >= timeout) {
          reject(new Error(`[webpatcher] poll() timed out after ${timeout}ms`));
          return;
        }
        setTimeout(tick, interval);
      })();
    });
  }

  function debounce<T extends (...args: any[]) => void>(
    fn: T,
    wait: number,
  ): T {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: unknown, ...args: Parameters<T>) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    } as T;
  }

  function throttle<T extends (...args: any[]) => void>(
    fn: T,
    wait: number,
  ): T {
    let last = 0;
    return function (this: unknown, ...args: Parameters<T>) {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn.apply(this, args);
      }
    } as T;
  }

  function onReady(fn: () => void): void {
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      fn();
    } else {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    }
  }

  return {
    get pathname() {
      return pathname;
    },

    $,
    $$,
    waitForElement,
    waitForElements,
    waitForElementWithText,
    onElementAdded,
    onElementRemoved,
    onElementModified,
    onAttributeChange,
    replaceElement,
    wrapElement,
    patchAttribute,
    patchText,
    addClass,
    removeClass,
    hideElement,
    injectStyle,
    injectScript,
    injectInlineScript,
    insertAdjacentElement,
    onCleanup,
    cleanup,
    poll,
    debounce,
    throttle,
    onReady,
  };
}
