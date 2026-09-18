import type { Locator } from "@playwright/test";
import { assertMaxArguments } from "./evaluation";
import { rejectUnsupportedOptions, validateForce } from "./protocolValidation";
import type { EvaluationFunction, EvaluationOptions } from "./evaluation";
import type {
  AriaSnapshotOptions,
  LocatorQueryOptions,
  LocatorVisibilityOptions,
  PageImpl,
  SelectOptionValue,
} from "./page";
import { withAbortPrefix } from "./page";
import { AdapterElementHandle } from "./elementHandle";
import type { InputFiles } from "./inputFiles";
import {
  formatLocatorDescription,
  locatorDescription,
} from "./locatorFormatting";
import {
  escapeForTextSelector,
  getByAltTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByRoleSelector,
  getByTestIdSelector,
  getByTextSelector,
  getByTitleSelector,
} from "./selectors";

/**
 * Cross-realm brand symbol. Any code can test for this with
 * `Symbol.for(...)` without importing LocatorImpl.
 */
export const LOCATOR_BRAND = Symbol.for("playwright-lite:locator");

/** Structured payload carried by the brand symbol. */
export type LocatorBrandPayload = {
  readonly ownerPage: PageImpl;
  readonly getSelector: () => string;
  readonly resolveElements: () => Element[];
};

export type ByRoleOptions = {
  name?: string | RegExp;
  exact?: boolean;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  includeHidden?: boolean;
  level?: number;
  pressed?: boolean;
  selected?: boolean;
  description?: string | RegExp;
};

type LocatorActionOptions = { signal?: AbortSignal; timeout?: number };
type LocatorActionWithNoWaitAfterOptions = LocatorActionOptions & {
  noWaitAfter?: boolean;
};
/** `force` is a protocol option of `fill`, `clear`, `selectOption` and `selectText`. */
type LocatorForcibleActionOptions = LocatorActionOptions & {
  force?: boolean;
};
type LocatorForcibleActionWithNoWaitAfterOptions =
  LocatorForcibleActionOptions & LocatorActionWithNoWaitAfterOptions;
/** Shared by `press`, `type` and `pressSequentially`. */
type LocatorKeyboardInputOptions = LocatorActionWithNoWaitAfterOptions & {
  delay?: number;
};

export type LocatorOptions = {
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  has?: LocatorImpl;
  hasNot?: LocatorImpl;
  visible?: boolean;
};

type HighlightOptions = NonNullable<Parameters<Locator["highlight"]>[0]>;
type HighlightDisposable = Awaited<ReturnType<Locator["highlight"]>>;

export class LocatorImpl {
  /**
   * Brand property carrying the structured payload.
   * Validated through {@link requireBrand} — no private-field casts needed.
   *
   * Pinned source ref: microsoft/playwright@26a9e47, Locator class uses
   * `_frame` and `_selector` directly; we expose equivalent access through
   * the brand payload instead.
   */
  readonly [LOCATOR_BRAND]!: LocatorBrandPayload;

  constructor(
    private readonly ownerPage: PageImpl,
    private selector: string,
    private readonly label: string,
    options?: LocatorOptions,
    private readonly customDescription?: string
  ) {
    // Mirrors pinned 26a9e47 Locator constructor option processing
    if (options?.hasText)
      this.selector += ` >> internal:has-text=${escapeForTextSelector(options.hasText, false)}`;
    if (options?.hasNotText)
      this.selector += ` >> internal:has-not-text=${escapeForTextSelector(options.hasNotText, false)}`;
    if (options?.has) {
      const brand = requireBrand(options.has, `Inner "has"`);
      if (brand.ownerPage !== this.ownerPage)
        throw new Error(`Inner "has" locator must belong to the same frame.`);
      this.selector +=
        ` >> internal:has=` + JSON.stringify(brand.getSelector());
    }
    if (options?.hasNot) {
      const brand = requireBrand(options.hasNot, `Inner "hasNot"`);
      if (brand.ownerPage !== this.ownerPage)
        throw new Error(
          `Inner "hasNot" locator must belong to the same frame.`
        );
      this.selector +=
        ` >> internal:has-not=` + JSON.stringify(brand.getSelector());
    }
    if (options?.visible !== undefined)
      this.selector += ` >> visible=${options.visible ? "true" : "false"}`;

    // Assign the frozen brand payload once, after all selector mutations.
    // Closures capture `this` so getSelector/resolveElements always reflect
    // the final selector value.
    this[LOCATOR_BRAND] = Object.freeze({
      ownerPage: this.ownerPage,
      getSelector: () => this.selector,
      resolveElements: () => this.ownerPage.resolveAll(this.selector),
    } satisfies LocatorBrandPayload);
  }

  // ── Selector composition ──────────────────────────────────────

  page() {
    return this.ownerPage;
  }

  describe(description: string) {
    return new LocatorImpl(
      this.ownerPage,
      `${this.selector} >> internal:describe=${JSON.stringify(description)}`,
      this.label,
      undefined,
      description
    );
  }

  description(): string | null {
    return locatorDescription(this.customDescription);
  }

  toString(): string {
    return formatLocatorDescription(this.label, this.customDescription);
  }

  getByRole(role: string, options: ByRoleOptions = {}) {
    const roleSelector = getByRoleSelector(role, options);
    return new LocatorImpl(
      this.ownerPage,
      `${this.selector} >> ${roleSelector}`,
      `${this.label}.getByRole(${JSON.stringify(role)}, ${JSON.stringify(options)})`
    );
  }

  getByText(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.locator(getByTextSelector(text, options.exact));
  }
  getByLabel(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.locator(getByLabelSelector(text, options.exact));
  }
  getByTestId(testId: string | RegExp) {
    return this.locator(
      getByTestIdSelector(this.ownerPage.testIdAttribute, testId)
    );
  }
  getByPlaceholder(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.locator(getByPlaceholderSelector(text, options.exact));
  }
  getByAltText(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.locator(getByAltTextSelector(text, options.exact));
  }
  getByTitle(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.locator(getByTitleSelector(text, options.exact));
  }

  /**
   * Mirrors pinned 26a9e47 Locator.locator:
   * - string → `this._selector + ' >> ' + selector`
   * - Locator → `this._selector + ' >> internal:chain=' + JSON.stringify(locator._selector)`
   */
  locator(
    selectorOrLocator: string | LocatorImpl,
    options?: Omit<LocatorOptions, "visible">
  ) {
    if (typeof selectorOrLocator === "string") {
      return new LocatorImpl(
        this.ownerPage,
        `${this.selector} >> ${selectorOrLocator}`,
        `${this.label}.locator(${JSON.stringify(selectorOrLocator)})`,
        options
      );
    }
    const brand = requireBrand(selectorOrLocator, "selectorOrLocator");
    if (brand.ownerPage !== this.ownerPage)
      throw new Error(`Locators must belong to the same frame.`);
    return new LocatorImpl(
      this.ownerPage,
      `${this.selector} >> internal:chain=` +
        JSON.stringify(brand.getSelector()),
      `${this.label}.locator(locator)`,
      options
    );
  }

  filter(options?: LocatorOptions) {
    return new LocatorImpl(
      this.ownerPage,
      this.selector,
      `${this.label}.filter(...)`,
      options
    );
  }

  /** Mirrors pinned 26a9e47 Locator.and selector serialization. */
  and(locator: LocatorImpl) {
    const brand = requireBrand(locator, "locator");
    if (brand.ownerPage !== this.ownerPage)
      throw new Error(`Locators must belong to the same frame.`);
    return new LocatorImpl(
      this.ownerPage,
      this.selector + ` >> internal:and=` + JSON.stringify(brand.getSelector()),
      `${this.label}.and(locator)`
    );
  }

  /** Mirrors pinned 26a9e47 Locator.or selector serialization. */
  or(locator: LocatorImpl) {
    const brand = requireBrand(locator, "locator");
    if (brand.ownerPage !== this.ownerPage)
      throw new Error(`Locators must belong to the same frame.`);
    return new LocatorImpl(
      this.ownerPage,
      this.selector + ` >> internal:or=` + JSON.stringify(brand.getSelector()),
      `${this.label}.or(locator)`
    );
  }

  nth(index: number) {
    return new LocatorImpl(
      this.ownerPage,
      `${this.selector} >> nth=${index}`,
      `${this.label}.nth(${index})`
    );
  }

  first() {
    return this.nth(0);
  }

  last() {
    return this.nth(-1);
  }

  // ── Collection ────────────────────────────────────────────────

  async all() {
    const count = this.ownerPage.resolveAll(this.selector).length;
    return Array.from({ length: count }, (_, i) => this.nth(i));
  }

  async count() {
    return this.ownerPage.resolveAll(this.selector).length;
  }

  async elementHandle(
    options: { timeout?: number } = {}
  ): Promise<AdapterElementHandle> {
    rejectUnsupportedOptions("elementHandle", options, ["timeout"]);
    const handle = await this.ownerPage.waitForSelector(this.selector, {
      strict: true,
      state: "attached",
      timeout: options.timeout,
    });
    if (!handle)
      throw new Error(`Could not resolve ${this.selector} to DOM Element`);
    return handle;
  }

  async elementHandles(): Promise<AdapterElementHandle[]> {
    return this.ownerPage
      .resolveAll(this.selector)
      .map((element) => this.ownerPage.elementHandleFor(element)!);
  }

  // ── Query and state operations ─────────────────────────────────

  async getAttribute(
    name: string,
    options?: LocatorQueryOptions
  ): Promise<string | null> {
    return withAbortPrefix("locator.getAttribute", () =>
      this.ownerPage.locatorGetAttribute(
        this.selector,
        this.label,
        name,
        options
      )
    );
  }

  async textContent(options?: LocatorQueryOptions): Promise<string | null> {
    return withAbortPrefix("locator.textContent", () =>
      this.ownerPage.locatorTextContent(this.selector, this.label, options)
    );
  }

  async innerText(options?: LocatorQueryOptions): Promise<string> {
    return withAbortPrefix("locator.innerText", () =>
      this.ownerPage.locatorInnerText(this.selector, this.label, options)
    );
  }

  async innerHTML(options?: LocatorQueryOptions): Promise<string> {
    return withAbortPrefix("locator.innerHTML", () =>
      this.ownerPage.locatorInnerHTML(this.selector, this.label, options)
    );
  }

  async allInnerTexts(): Promise<string[]> {
    return this.ownerPage.locatorAllInnerTexts(this.selector);
  }

  async allTextContents(): Promise<string[]> {
    return this.ownerPage.locatorAllTextContents(this.selector);
  }

  async inputValue(options?: LocatorQueryOptions): Promise<string> {
    return withAbortPrefix("locator.inputValue", () =>
      this.ownerPage.locatorInputValue(this.selector, this.label, options)
    );
  }

  async isEnabled(options?: LocatorQueryOptions): Promise<boolean> {
    return withAbortPrefix("locator.isEnabled", () =>
      this.ownerPage.locatorIsEnabled(this.selector, this.label, options)
    );
  }

  async isDisabled(options?: LocatorQueryOptions): Promise<boolean> {
    return withAbortPrefix("locator.isDisabled", () =>
      this.ownerPage.locatorIsDisabled(this.selector, this.label, options)
    );
  }

  async isChecked(options?: LocatorQueryOptions): Promise<boolean> {
    return withAbortPrefix("locator.isChecked", () =>
      this.ownerPage.locatorIsChecked(this.selector, this.label, options)
    );
  }

  async isEditable(options?: LocatorQueryOptions): Promise<boolean> {
    return withAbortPrefix("locator.isEditable", () =>
      this.ownerPage.locatorIsEditable(this.selector, this.label, options)
    );
  }

  async isVisible(options?: LocatorVisibilityOptions): Promise<boolean> {
    return this.ownerPage.locatorIsVisible(this.selector, this.label, options);
  }

  async isHidden(options?: LocatorVisibilityOptions): Promise<boolean> {
    return !this.ownerPage.locatorIsVisible(this.selector, this.label, options);
  }

  async boundingBox(options?: LocatorQueryOptions) {
    return withAbortPrefix("locator.boundingBox", () =>
      this.ownerPage.locatorBoundingBox(this.selector, this.label, options)
    );
  }

  /**
   * Captures the accessibility snapshot rooted at this locator's sole element.
   *
   * The compiled InjectedScript remains the only ARIA implementation. This
   * method intentionally resolves within the one controlled document and does
   * not add frame traversal or browser-process behavior.
   */
  async ariaSnapshot(options: AriaSnapshotOptions = {}): Promise<string> {
    return withAbortPrefix("locator.ariaSnapshot", () =>
      this.ownerPage.locatorAriaSnapshot(this.selector, this.label, options)
    );
  }

  // ── Expectations and callback operations ────────────────────────

  /**
   * The public Playwright matcher implementation calls this private-shaped
   * protocol method. Keep it here, rather than teaching the bridge about
   * individual matchers, so the pinned InjectedScript remains the semantic
   * authority for text, count, and element-state expectations.
   */
  async _expect(expression: string, options: Record<string, unknown>) {
    return this.ownerPage.expect(this.selector, expression, options);
  }

  async highlight(
    options: HighlightOptions = {}
  ): Promise<HighlightDisposable> {
    const style =
      typeof options.style === "object"
        ? cssObjectToString(options.style)
        : options.style;
    await this.ownerPage.addHighlight(this.selector, style);
    return new HighlightDisposableImpl(() => this.hideHighlight());
  }

  async hideHighlight(): Promise<void> {
    await this.ownerPage.removeHighlight(this.selector);
  }

  async evaluate<R>(
    pageFunction: EvaluationFunction<R>,
    arg?: unknown,
    options?: LocatorQueryOptions & EvaluationOptions
  ): Promise<R> {
    assertMaxArguments(arguments.length, 3);
    return withAbortPrefix("locator.evaluate", () =>
      this.ownerPage.locatorEvaluate(
        this.selector,
        this.label,
        pageFunction,
        arg,
        options
      )
    );
  }

  async evaluateAll<R>(
    pageFunction: EvaluationFunction<R>,
    arg?: unknown
  ): Promise<R> {
    assertMaxArguments(arguments.length, 2);
    return this.ownerPage.$$eval(this.selector, pageFunction, arg);
  }

  // ── Terminal operations (delegated to Page) ───────────────────

  async click(options?: Parameters<Locator["click"]>[0]) {
    await this.ownerPage.clickSelector(
      this.selector,
      this.label,
      options?.timeout,
      undefined,
      { ...options, strict: true }
    );
  }

  async fill(
    value: string,
    options?: LocatorForcibleActionWithNoWaitAfterOptions
  ) {
    rejectUnsupportedOptions("fill", options, [
      "force",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    const force = validateForce("fill", options?.force);
    await withAbortPrefix("locator.fill", () =>
      this.ownerPage.fillSelector(
        this.selector,
        value,
        this.label,
        options?.timeout,
        undefined,
        true,
        options?.signal,
        "fill",
        force
      )
    );
  }

  async setInputFiles(
    files: InputFiles,
    options?: LocatorActionWithNoWaitAfterOptions
  ) {
    rejectUnsupportedOptions("setInputFiles", options, [
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("locator.setInputFiles", () =>
      this.ownerPage.setInputFilesSelector(this.selector, files, options, true)
    );
  }

  async drop(
    payload: Parameters<Locator["drop"]>[0],
    options?: Parameters<Locator["drop"]>[1]
  ) {
    await this.ownerPage.dropSelector(
      this.selector,
      this.label,
      payload,
      options
    );
  }

  async press(key: string, options?: LocatorKeyboardInputOptions) {
    const delay = rejectUnsupportedOptions("press", options, [
      "delay",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("locator.press", () =>
      this.ownerPage.pressSelector(
        this.selector,
        key,
        this.label,
        options?.timeout,
        undefined,
        true,
        options?.signal,
        delay
      )
    );
  }

  async focus(options?: LocatorQueryOptions) {
    rejectUnsupportedOptions("focus", options, ["signal", "timeout"]);
    await withAbortPrefix("locator.focus", () =>
      this.ownerPage.focusSelector(this.selector, this.label, options)
    );
  }

  async blur(options?: LocatorQueryOptions) {
    rejectUnsupportedOptions("blur", options, ["signal", "timeout"]);
    await withAbortPrefix("locator.blur", () =>
      this.ownerPage.blurSelector(this.selector, this.label, options)
    );
  }

  async clear(options?: LocatorForcibleActionWithNoWaitAfterOptions) {
    rejectUnsupportedOptions("clear", options, [
      "force",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    const force = validateForce("clear", options?.force);
    await withAbortPrefix("locator.clear", () =>
      this.ownerPage.fillSelector(
        this.selector,
        "",
        this.label,
        options?.timeout,
        undefined,
        true,
        options?.signal,
        "clear",
        force
      )
    );
  }

  async hover(options?: Parameters<Locator["hover"]>[0]) {
    await this.ownerPage.hoverSelector(
      this.selector,
      this.label,
      options?.timeout,
      undefined,
      { ...options, strict: true }
    );
  }

  async check(options?: Parameters<Locator["check"]>[0]) {
    await this.ownerPage.setCheckedSelector(
      this.selector,
      true,
      this.label,
      { ...options, strict: true },
      undefined,
      "check"
    );
  }

  async uncheck(options?: Parameters<Locator["uncheck"]>[0]) {
    await this.ownerPage.setCheckedSelector(
      this.selector,
      false,
      this.label,
      { ...options, strict: true },
      undefined,
      "uncheck"
    );
  }

  async setChecked(
    checked: boolean,
    options?: Parameters<Locator["setChecked"]>[1]
  ) {
    await this.ownerPage.setCheckedSelector(
      this.selector,
      checked,
      this.label,
      { ...options, strict: true }
    );
  }

  async dblclick(options?: Parameters<Locator["dblclick"]>[0]) {
    await this.ownerPage.dblclickSelector(this.selector, this.label, {
      ...options,
      strict: true,
    });
  }

  async dispatchEvent(
    type: string,
    eventInit: object = {},
    options?: LocatorActionOptions
  ) {
    rejectUnsupportedOptions("dispatchEvent", options, ["signal", "timeout"]);
    await withAbortPrefix("locator.dispatchEvent", () =>
      this.ownerPage.dispatchEventSelector(
        this.selector,
        type,
        eventInit,
        this.label,
        options?.timeout,
        undefined,
        true,
        options?.signal
      )
    );
  }

  async selectOption(
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    options?: LocatorForcibleActionWithNoWaitAfterOptions
  ) {
    rejectUnsupportedOptions("selectOption", options, [
      "force",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    const force = validateForce("selectOption", options?.force);
    return withAbortPrefix("locator.selectOption", () =>
      this.ownerPage.selectOptionSelector(
        this.selector,
        values,
        this.label,
        options?.timeout,
        undefined,
        true,
        options?.signal,
        force
      )
    );
  }

  async selectText(options?: LocatorForcibleActionOptions) {
    rejectUnsupportedOptions("selectText", options, [
      "force",
      "signal",
      "timeout",
    ]);
    const force = validateForce("selectText", options?.force);
    await withAbortPrefix("locator.selectText", () =>
      this.ownerPage.selectText(
        this.selector,
        this.label,
        options?.timeout,
        undefined,
        options?.signal,
        force
      )
    );
  }

  async scrollIntoViewIfNeeded(options?: LocatorActionOptions) {
    rejectUnsupportedOptions("scrollIntoViewIfNeeded", options, [
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("locator.scrollIntoViewIfNeeded", () =>
      this.ownerPage.scrollLocatorIntoView(
        this.selector,
        this.label,
        options?.timeout,
        undefined,
        options?.signal
      )
    );
  }

  async type(
    text: string,
    options: LocatorKeyboardInputOptions = {}
  ): Promise<void> {
    await withAbortPrefix("locator.type", () => this.typeText(text, options));
  }

  async pressSequentially(
    text: string,
    options: LocatorKeyboardInputOptions = {}
  ): Promise<void> {
    await withAbortPrefix("locator.pressSequentially", () =>
      this.typeText(text, options)
    );
  }

  private async typeText(text: string, options: LocatorKeyboardInputOptions) {
    rejectUnsupportedOptions("type", options, [
      "delay",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    await this.ownerPage.typeSelector(
      this.selector,
      text,
      options,
      this.label,
      true
    );
  }

  async waitFor(
    options: {
      signal?: AbortSignal;
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    } = {}
  ) {
    const state = options.state ?? "visible";
    rejectUnsupportedOptions("waitFor", options, [
      "signal",
      "state",
      "timeout",
    ]);
    await withAbortPrefix("locator.waitFor", () =>
      this.ownerPage.waitForState(
        this.selector,
        { signal: options.signal, state, timeout: options.timeout },
        this.label
      )
    );
  }
}

// ── Brand validation ────────────────────────────────────────────────

/**
 * Single validation helper for the structured brand payload.
 * Every public resolver function delegates to this; no private-field casts
 * exist outside this function.
 */
function requireBrand(value: unknown, context: string): LocatorBrandPayload {
  if (typeof value !== "object" || value === null || !(LOCATOR_BRAND in value))
    throw new TypeError(
      `${context}: expected an PlaywrightLite Locator, ` +
        `got ${value === null ? "null" : typeof value}`
    );
  const payload = (value as Record<symbol, unknown>)[LOCATOR_BRAND];
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).getSelector !== "function" ||
    typeof (payload as Record<string, unknown>).resolveElements !== "function"
  )
    throw new TypeError(
      `${context}: expected an PlaywrightLite Locator, got incompatible branded object`
    );
  return payload as LocatorBrandPayload;
}

// ── Public resolver API ─────────────────────────────────────────────

/**
 * Returns `true` if `value` carries a valid structured locator brand.
 * Does NOT use `instanceof`; works cross-realm.
 */
export function isPlaywrightLiteLocator(value: unknown): boolean {
  try {
    requireBrand(value, "isPlaywrightLiteLocator");
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts the selector string from a branded locator.
 * Throws diagnostically for non-locator values and cross-page locators.
 */
export function extractSelector(
  locator: unknown,
  callerPage: PageImpl,
  paramName: string
): string {
  const brand = requireBrand(locator, paramName);
  if (brand.ownerPage !== callerPage)
    throw new Error(
      `${paramName}: locator belongs to a different Page; ` +
        `cross-page filter locators are not supported`
    );
  return brand.getSelector();
}

/**
 * Resolves the matching DOM elements for a branded locator.
 * Throws for non-locator values.
 */
export function resolveLocatorElements(value: unknown): Element[] {
  return requireBrand(value, "resolveLocatorElements").resolveElements();
}

// ── Helpers ─────────────────────────────────────────────────────────

function cssObjectToString(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const property = key.startsWith("--")
        ? key
        : key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      return `${property}: ${value}`;
    })
    .join("; ");
}

class HighlightDisposableImpl implements HighlightDisposable {
  private disposeCallback: (() => Promise<void>) | undefined;

  constructor(dispose: () => Promise<void>) {
    this.disposeCallback = dispose;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  async dispose(): Promise<void> {
    const dispose = this.disposeCallback;
    if (!dispose) return;
    this.disposeCallback = undefined;
    await dispose();
  }
}
