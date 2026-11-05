declare interface DynamicPatch {
  name: string;
  match?: string[];
  run(ctx: PatchContext): void | Promise<void>;
}

declare interface Disposable {
  dispose(): void;
}

declare interface WaitOptions {
  timeout?: number;
  root?: Element | Document;
}

declare interface ObserveOptions {
  root?: Element | Document;
  subtree?: boolean;
}

declare interface ModifyObserveOptions extends ObserveOptions {
  attributes?: boolean;
  childList?: boolean;
  characterData?: boolean;
}

declare interface ReplaceOptions {
  root?: Element | Document;
  persistent?: boolean;
}

declare interface StyleOptions {
  id?: string;
  prepend?: boolean;
}

declare interface PollOptions {
  interval?: number;
  timeout?: number;
}

declare interface PatchContext {
  readonly pathname: string;

  $<T extends Element = Element>(selector: string, root?: ParentNode): T | null;

  $$<T extends Element = Element>(selector: string, root?: ParentNode): T[];

  waitForElement<T extends Element = Element>(
    selector: string,
    options?: WaitOptions
  ): Promise<T>;

  waitForElements<T extends Element = Element>(
    selector: string,
    options?: WaitOptions & { count?: number }
  ): Promise<T[]>;

  waitForElementWithText<T extends Element = Element>(
    selector: string,
    text: string | RegExp,
    options?: WaitOptions
  ): Promise<T>;
  onElementAdded<T extends Element = Element>(
    selector: string,
    callback: (el: T) => void,
    options?: ObserveOptions
  ): Disposable;

  onElementRemoved<T extends Element = Element>(
    selector: string,
    callback: (el: T) => void,
    options?: ObserveOptions
  ): Disposable;

  onElementModified<T extends Element = Element>(
    selector: string,
    callback: (el: T, mutation: MutationRecord) => void,
    options?: ModifyObserveOptions
  ): Disposable;

  onAttributeChange<T extends Element = Element>(
    selector: string,
    attribute: string | string[],
    callback: (el: T, newValue: string | null, oldValue: string | null) => void,
    options?: ObserveOptions
  ): Disposable;

  replaceElement<T extends Element = Element>(
    selector: string,
    factory: (original: T) => Element,
    options?: ReplaceOptions
  ): Disposable;

  wrapElement<T extends Element = Element>(
    selector: string,
    wrapperFactory: () => Element,
    options?: ReplaceOptions
  ): Disposable;

  patchAttribute(
    selector: string,
    attribute: string,
    value: string | ((current: string | null, el: Element) => string),
    options?: ObserveOptions
  ): Disposable;

  patchText(
    selector: string,
    replacer: string | RegExp,
    replacement: string | ((match: string, el: Element) => string),
    options?: ObserveOptions
  ): Disposable;

  addClass(selector: string, ...classes: string[]): Disposable;

  removeClass(selector: string, ...classes: string[]): Disposable;

  hideElement(selector: string): Disposable;

  injectStyle(css: string, options?: StyleOptions): Disposable;

  injectScript(src: string): Promise<Disposable>;

  injectInlineScript(code: string): void;

  insertAdjacentElement(
    anchor: string | Element,
    position: InsertPosition,
    el: Element,
    options?: ObserveOptions
  ): Disposable;

  onCleanup(fn: () => void): void;

  cleanup(): void;

  poll<T>(
    fn: () => T | null | undefined | false,
    options?: PollOptions
  ): Promise<T>;

  debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T;

  throttle<T extends (...args: any[]) => void>(fn: T, wait: number): T;

  onReady(fn: () => void): void;
}
