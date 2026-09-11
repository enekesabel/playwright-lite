import type {
  AriaSnapshotOptions,
  PointerActionOptions,
  LocatorQueryOptions,
  PageImpl,
  SelectOptionValue,
} from "./page";
import { AdapterElementHandle } from "./elementHandle";
import type { InputFiles } from "./inputFiles";
import { testIdAttributeNameFor } from "./injected";
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
export const LOCATOR_BRAND = Symbol.for("ayme:locator");

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

type LocatorActionOptions = { timeout?: number };
type LocatorTypeOptions = LocatorActionOptions & { delay?: number };

export type LocatorOptions = {
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  has?: LocatorImpl;
  hasNot?: LocatorImpl;
  visible?: boolean;
};

export class LocatorImpl {
  /**
   * Brand property carrying the structured payload.
   * Validated through {@link requireBrand} — no private-field casts needed.
   *
   * Pinned source ref: ayme-labs/playwright@b25d782, Locator class uses
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
    // Mirrors pinned b25d782 Locator constructor option processing
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
      getByTestIdSelector(testIdAttributeNameFor(this.ownerPage.window), testId)
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
   * Mirrors pinned b25d782 Locator.locator:
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

  /** Mirrors pinned b25d782 Locator.and selector serialization. */
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

  /** Mirrors pinned b25d782 Locator.or selector serialization. */
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
    return this.ownerPage.locatorGetAttribute(
      this.selector,
      this.label,
      name,
      options
    );
  }

  async textContent(options?: LocatorQueryOptions): Promise<string | null> {
    return this.ownerPage.locatorTextContent(
      this.selector,
      this.label,
      options
    );
  }

  async innerText(options?: LocatorQueryOptions): Promise<string> {
    return this.ownerPage.locatorInnerText(this.selector, this.label, options);
  }

  async innerHTML(options?: LocatorQueryOptions): Promise<string> {
    return this.ownerPage.locatorInnerHTML(this.selector, this.label, options);
  }

  async allInnerTexts(): Promise<string[]> {
    return this.ownerPage.locatorAllInnerTexts(this.selector);
  }

  async allTextContents(): Promise<string[]> {
    return this.ownerPage.locatorAllTextContents(this.selector);
  }

  async inputValue(options?: LocatorQueryOptions): Promise<string> {
    return this.ownerPage.locatorInputValue(this.selector, this.label, options);
  }

  async isEnabled(options?: LocatorQueryOptions): Promise<boolean> {
    return this.ownerPage.locatorIsEnabled(this.selector, this.label, options);
  }

  async isDisabled(options?: LocatorQueryOptions): Promise<boolean> {
    return this.ownerPage.locatorIsDisabled(this.selector, this.label, options);
  }

  async isChecked(options?: LocatorQueryOptions): Promise<boolean> {
    return this.ownerPage.locatorIsChecked(this.selector, this.label, options);
  }

  async isEditable(options?: LocatorQueryOptions): Promise<boolean> {
    return this.ownerPage.locatorIsEditable(this.selector, this.label, options);
  }

  async isVisible(options?: LocatorQueryOptions): Promise<boolean> {
    return this.ownerPage.locatorIsVisible(this.selector, this.label, options);
  }

  async isHidden(options?: LocatorQueryOptions): Promise<boolean> {
    return !this.ownerPage.locatorIsVisible(this.selector, this.label, options);
  }

  async boundingBox(options?: LocatorQueryOptions) {
    return this.ownerPage.locatorBoundingBox(
      this.selector,
      this.label,
      options
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
    return this.ownerPage.locatorAriaSnapshot(
      this.selector,
      this.label,
      options
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

  async evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageFunction: (element: Element, arg?: unknown) => any,
    arg?: unknown,
    options?: LocatorQueryOptions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    return this.ownerPage.locatorEvaluate(
      this.selector,
      this.label,
      pageFunction,
      arg,
      options
    );
  }

  async evaluateAll(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageFunction: (elements: Element[], arg?: unknown) => any,
    arg?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    return await pageFunction(this.ownerPage.resolveAll(this.selector), arg);
  }

  // ── Terminal operations (delegated to Page) ───────────────────

  async click(options?: PointerActionOptions) {
    rejectUnsupportedOptions("click", options, [
      "timeout",
      "position",
      "trial",
    ]);
    await this.ownerPage.clickSelector(
      this.selector,
      this.label,
      options?.timeout,
      undefined,
      options
    );
  }

  async fill(value: string, options?: LocatorActionOptions) {
    rejectUnsupportedOptions("fill", options, ["timeout"]);
    await this.ownerPage.fillSelector(
      this.selector,
      value,
      this.label,
      options?.timeout
    );
  }

  async setInputFiles(files: InputFiles, options?: LocatorActionOptions) {
    rejectUnsupportedOptions("setInputFiles", options, ["timeout"]);
    await this.ownerPage.setInputFilesSelector(
      this.selector,
      files,
      options,
      true
    );
  }

  async press(key: string, options?: LocatorActionOptions) {
    rejectUnsupportedOptions("press", options, ["timeout"]);
    await this.ownerPage.pressSelector(
      this.selector,
      key,
      this.label,
      options?.timeout
    );
  }

  async focus(options?: LocatorQueryOptions) {
    await this.ownerPage.focusSelector(this.selector, this.label, options);
  }

  async blur(options?: LocatorQueryOptions) {
    await this.ownerPage.blurSelector(this.selector, this.label, options);
  }

  async clear(options?: LocatorActionOptions) {
    rejectUnsupportedOptions("clear", options, ["timeout"]);
    await this.ownerPage.fillSelector(
      this.selector,
      "",
      this.label,
      options?.timeout
    );
  }

  async hover(options?: LocatorActionOptions) {
    rejectUnsupportedOptions("hover", options, ["timeout"]);
    await this.ownerPage.hoverSelector(
      this.selector,
      this.label,
      options?.timeout
    );
  }

  async check(options?: PointerActionOptions) {
    rejectUnsupportedOptions("check", options, [
      "position",
      "timeout",
      "trial",
    ]);
    await this.ownerPage.setCheckedSelector(
      this.selector,
      true,
      this.label,
      options
    );
  }

  async uncheck(options?: PointerActionOptions) {
    rejectUnsupportedOptions("uncheck", options, [
      "position",
      "timeout",
      "trial",
    ]);
    await this.ownerPage.setCheckedSelector(
      this.selector,
      false,
      this.label,
      options
    );
  }

  async setChecked(checked: boolean, options?: PointerActionOptions) {
    rejectUnsupportedOptions("setChecked", options, [
      "position",
      "timeout",
      "trial",
    ]);
    await this.ownerPage.setCheckedSelector(
      this.selector,
      checked,
      this.label,
      options
    );
  }

  async dblclick(options?: PointerActionOptions) {
    rejectUnsupportedOptions("dblclick", options, [
      "position",
      "timeout",
      "trial",
    ]);
    await this.ownerPage.dblclickSelector(this.selector, this.label, options);
  }

  async dispatchEvent(
    type: string,
    eventInit: object = {},
    options?: LocatorActionOptions
  ) {
    rejectUnsupportedOptions("dispatchEvent", options, ["timeout"]);
    await this.ownerPage.dispatchEventSelector(
      this.selector,
      type,
      eventInit,
      this.label,
      options?.timeout
    );
  }

  async selectOption(
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    options?: LocatorActionOptions
  ) {
    rejectUnsupportedOptions("selectOption", options, ["timeout"]);
    return this.ownerPage.selectOptionSelector(
      this.selector,
      values,
      this.label,
      options?.timeout
    );
  }

  async selectText(options?: LocatorActionOptions) {
    rejectUnsupportedOptions("selectText", options, ["timeout"]);
    await this.ownerPage.selectText(
      this.selector,
      this.label,
      options?.timeout
    );
  }

  async scrollIntoViewIfNeeded(options?: LocatorActionOptions) {
    rejectUnsupportedOptions("scrollIntoViewIfNeeded", options, ["timeout"]);
    await this.ownerPage.scrollLocatorIntoView(
      this.selector,
      this.label,
      options?.timeout
    );
  }

  async type(text: string, options: LocatorTypeOptions = {}): Promise<void> {
    rejectUnsupportedOptions("type", options, ["delay", "timeout"]);
    await this.ownerPage.type(this.selector, text, options, this.label);
  }

  async pressSequentially(
    text: string,
    options: LocatorTypeOptions = {}
  ): Promise<void> {
    await this.type(text, options);
  }

  async waitFor(
    options: {
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    } = {}
  ) {
    const state = options.state ?? "visible";
    rejectUnsupportedOptions("waitFor", options, ["state", "timeout"]);
    await this.ownerPage.waitForState(
      this.selector,
      { state, timeout: options.timeout },
      this.label
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
      `${context}: expected an Ayme Locator, ` +
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
      `${context}: expected an Ayme Locator, got incompatible branded object`
    );
  return payload as LocatorBrandPayload;
}

// ── Public resolver API ─────────────────────────────────────────────

/**
 * Returns `true` if `value` carries a valid structured locator brand.
 * Does NOT use `instanceof`; works cross-realm.
 */
export function isAymeLocator(value: unknown): boolean {
  try {
    requireBrand(value, "isAymeLocator");
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

function rejectUnsupportedOptions(
  method: string,
  options: Record<string, unknown> | undefined,
  supported: string[] = []
): void {
  if (!options) return;
  const unsupported = Object.keys(options).filter(
    (key) => options[key] !== undefined && !supported.includes(key)
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${method}(): unsupported Playwright option(s): ${unsupported.join(", ")}.`
    );
  }
}
