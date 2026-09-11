import {
  injectedScriptFor,
  parseAriaExpectation,
  testIdAttributeNameFor,
} from "./injected";
import { AdapterTimeoutError } from "./errors";
import { AdapterElementHandle } from "./elementHandle";
import { inputFilePayloads, type InputFiles } from "./inputFiles";
import { keyboardLayout, type KeyboardKeyDescription } from "./keyboardLayout";
import type { Page } from "@playwright/test";
import type { ByRoleOptions, LocatorOptions } from "./locator";
import { LocatorImpl } from "./locator";
import {
  getByAltTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByRoleSelector,
  getByTestIdSelector,
  getByTextSelector,
  getByTitleSelector,
} from "./selectors";

type InjectedExpectation = {
  matches: boolean;
  received?: { value?: unknown; ariaSnapshot?: string };
};

type LocatorExpectationResult = {
  matches: boolean;
  received?: { value?: unknown; ariaSnapshot?: string };
  timedOut?: boolean;
  errorMessage?: string;
  log?: string[];
};

type LocatorExpectationOptions = Record<string, unknown> & {
  isNot?: boolean;
  signal?: AbortSignal;
  timeout?: number;
};

type LocatorExpectationAttempt = {
  matches: boolean;
  received?: { value?: unknown; ariaSnapshot?: string };
  missing: boolean;
};

const DEFAULT_EXPECT_TIMEOUT = 5_000;
const EXPECT_RETRY_BACKOFF = [20, 50, 100, 100, 500];
const DEFAULT_ACTION_TIMEOUT = 1_000;
const DEFAULT_NAVIGATION_TIMEOUT = 30_000;
const ACTION_RETRY_DELAY = 50;
const DEFAULT_QUERY_TIMEOUT = 0;
const QUERY_RETRY_DELAY = 50;

type ActionPoint = { x: number; y: number };
type ActionDeadline = { timeout: number; expiresAt: number };
type ActionTarget = { element: Element; point: ActionPoint };

export type SelectorQueryOptions = {
  signal?: AbortSignal;
  strict?: boolean;
  timeout?: number;
};

export type LocatorQueryOptions = Omit<SelectorQueryOptions, "strict">;

type WaitForSelectorOptions = {
  state?: "attached" | "detached" | "visible" | "hidden";
  strict?: boolean;
  timeout?: number;
};

type PageActionOptions = { timeout?: number };
type PageTypeOptions = PageActionOptions & { delay?: number };
export type PointerActionOptions = PageActionOptions & {
  position?: ActionPoint;
  trial?: boolean;
};

export type AriaSnapshotOptions = {
  boxes?: boolean;
  depth?: number;
  mode?: "ai" | "default";
  signal?: AbortSignal;
  timeout?: number;
};

type QueryState = "enabled" | "disabled" | "editable" | "checked";

type QueryStateResult =
  | { matches: boolean; received: string; isRadio?: boolean }
  | { matches: false; received: "error:notconnected" };

export type SelectOptionValue = {
  index?: number;
  label?: string;
  value?: string;
};

type QueryCapableInjectedScript = {
  elementState(element: Element, state: QueryState): QueryStateResult;
  retarget(element: Element, behavior: "follow-label"): Element | null;
};

type ExpectCapableInjectedScript = {
  expect(
    element: Element | undefined,
    options: { expression: string } & Record<string, unknown>,
    elements: Element[]
  ): Promise<InjectedExpectation>;
};

type ActionableInjectedScript = {
  checkElementStates(
    element: Element,
    states: ("visible" | "enabled" | "editable" | "stable")[]
  ): Promise<
    | "error:notconnected"
    | { missingState: "visible" | "enabled" | "editable" | "stable" }
    | undefined
  >;
  expectHitTarget(
    point: { x: number; y: number },
    element: Element
  ): "done" | { hitTargetDescription: string };
  fill(
    element: Element,
    value: string
  ): "error:notconnected" | "needsinput" | "done";
  focusNode(
    element: Element,
    resetSelectionIfNotFocused?: boolean
  ): "error:notconnected" | "done";
  blurNode(element: Element): "error:notconnected" | "done";
  selectOptions(
    element: Element,
    options: ({ valueOrLabel: string } | SelectOptionValue)[]
  ):
    | "error:notconnected"
    | "error:optionsnotfound"
    | "error:optionnotenabled"
    | string[];
  selectText(element: Element): "error:notconnected" | "done";
  dispatchEvent(node: Node, type: string, eventInitObj: object): void;
};

/**
 * Normalizes an expression the same way pinned b25d782
 * server/javascript.ts normalizeEvaluationExpression does:
 *   - isFunction=true: ensure the expression is a valid function expression
 *     (wrap in parens, or prefix `function` for shorthand methods)
 *   - Any expression matching /^(async)?\s*function(\s|\()/ gets parens
 */
function normalizeExpression(expression: string, isFunction: boolean): string {
  let expr = expression.trim();
  if (isFunction) {
    try {
      new Function("(" + expr + ")");
    } catch {
      if (expr.startsWith("async "))
        expr = "async function " + expr.substring("async ".length);
      else expr = "function " + expr;
      try {
        new Function("(" + expr + ")");
      } catch {
        throw new Error("Passed function is not well-serializable!");
      }
    }
  }
  if (/^(async)?\s*function(\s|\()/.test(expr)) expr = "(" + expr + ")";
  return expr;
}

/**
 * Minimal JSHandle mirroring pinned b25d782 client JSHandle interface.
 * Returned by waitForFunction so callers can use `.jsonValue()` /
 * `.dispose()` without a harness-only shim.
 */
export class AdapterJSHandle<T = unknown> {
  private _value: T;

  constructor(value: T) {
    this._value = value;
  }

  async jsonValue(): Promise<T> {
    return this._value;
  }

  async dispose(): Promise<void> {
    // No remote object to release in a single-document adapter.
  }
}

export class PageImpl {
  readonly document: Document;
  readonly window: Window & typeof globalThis;
  readonly keyboard: BrowserKeyboard;
  private _injected: ReturnType<typeof injectedScriptFor> | undefined;
  private _injectedTestIdAttributeName: string | undefined;
  private defaultTimeout: number | undefined;
  private defaultNavigationTimeout: number | undefined;

  constructor(browserWindow: Window & typeof globalThis) {
    this.window = browserWindow;
    this.document = browserWindow.document;
    this.keyboard = new BrowserKeyboard(this);
  }

  private get injected() {
    const testIdAttributeName = testIdAttributeNameFor(this.window);
    if (
      !this._injected ||
      this._injectedTestIdAttributeName !== testIdAttributeName
    ) {
      this._injected = injectedScriptFor(this.document.documentElement);
      this._injectedTestIdAttributeName = testIdAttributeName;
    }
    return this._injected;
  }

  static fromWindow(browserWindow: Window & typeof globalThis = window) {
    return new PageImpl(browserWindow);
  }

  // ── Resolution ──────────────────────────────────────────────────

  resolveAll(selector: string): Element[] {
    try {
      const parsed = this.injected.parseSelector(selector);
      return this.injected.querySelectorAll(parsed, this.document);
    } catch (error) {
      throw presentOriginalXPath(error, selector);
    }
  }

  resolveWithinElement(
    root: Element,
    selector: string,
    strict: boolean
  ): Element | undefined {
    try {
      const parsed = this.injected.parseSelector(selector);
      return this.injected.querySelector(parsed, root, strict);
    } catch (error) {
      throw presentOriginalXPath(error, selector);
    }
  }

  resolveAllWithinElement(root: Element, selector: string): Element[] {
    try {
      const parsed = this.injected.parseSelector(selector);
      return this.injected.querySelectorAll(parsed, root);
    } catch (error) {
      throw presentOriginalXPath(error, selector);
    }
  }

  elementHandleFor(element: Element | undefined): AdapterElementHandle | null {
    return element ? new AdapterElementHandle(this, element) : null;
  }

  requireSingle(selector: string, label: string): Element {
    const element = this.resolveLocatorElement(selector, true);
    if (!element) throw new Error(`No elements found for locator ${label}`);
    return element;
  }

  // ── State ───────────────────────────────────────────────────────

  elementState(element: Element, state: "visible" | "hidden") {
    return this.injected.elementState(element, state);
  }

  // ── Selector query operations ──────────────────────────────────

  async getAttribute(
    selector: string,
    name: string,
    options?: SelectorQueryOptions
  ): Promise<string | null> {
    return this.query(
      selector,
      `page.getAttribute(${JSON.stringify(selector)}, ${JSON.stringify(name)})`,
      options,
      false,
      (element) => element.getAttribute(name)
    );
  }

  async textContent(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string | null> {
    return this.query(
      selector,
      `page.textContent(${JSON.stringify(selector)})`,
      options,
      false,
      (element) => element.textContent
    );
  }

  async inputValue(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string> {
    return this.query(
      selector,
      `page.inputValue(${JSON.stringify(selector)})`,
      options,
      false,
      (element) => this.inputValueForElement(element)
    );
  }

  async isEnabled(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "enabled", options, false);
  }

  async isDisabled(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "disabled", options, false);
  }

  async isChecked(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "checked", options, false);
  }

  async $(
    selector: string,
    options: Pick<SelectorQueryOptions, "strict"> = {}
  ): Promise<AdapterElementHandle | null> {
    assertDollarOptions(options);
    return this.elementHandleFor(
      this.resolveLocatorElement(selector, options.strict === true)
    );
  }

  async $$(selector: string): Promise<AdapterElementHandle[]> {
    return this.resolveAll(selector).map((element) =>
      this.elementHandleFor(element)!
    );
  }

  async waitForSelector(
    selector: string,
    options: WaitForSelectorOptions = {}
  ): Promise<AdapterElementHandle | null> {
    return await this.waitForSelectorInRoot(this.document, selector, options);
  }

  async waitForSelectorWithinElement(
    root: Element,
    selector: string,
    options: Omit<WaitForSelectorOptions, "strict"> = {}
  ): Promise<AdapterElementHandle | null> {
    return await this.waitForSelectorInRoot(root, selector, options, false);
  }

  /**
   * Adapts the client Locator._expect protocol to InjectedScript.expect.
   *
   * Pinned b25d782 `Frame.expect` performs one check and then retries with
   * bounded backoff. InjectedScript remains responsible for each matcher
   * evaluation. This method only supplies the client/server orchestration that
   * is feasible within the controlled document.
   */
  async expect(
    selector: string,
    expression: string,
    options: Record<string, unknown>
  ): Promise<LocatorExpectationResult> {
    const expectOptions = options as LocatorExpectationOptions;
    const isNot = !!expectOptions.isNot;
    const timeout = expectationTimeout(expectOptions.timeout);
    const signal = expectOptions.signal;

    if (signal?.aborted) return abortedExpectationResult(isNot, signal);

    const deadline = Date.now() + timeout;

    // The pinned server performs an immediate check before entering its retry
    // loop. It lets already-matching assertions succeed even with tiny timeouts.
    const firstAttempt = await this.expectOnce(selector, expression, options);
    if (firstAttempt.matches !== isNot) return { matches: !isNot };

    let lastAttempt = firstAttempt;
    let retryIndex = 0;

    while (Date.now() < deadline) {
      const backoff = expectationBackoff(timeout, retryIndex++);
      const delay = Math.min(backoff, Math.max(0, deadline - Date.now()));
      if (
        delay > 0 &&
        !(await waitForExpectationRetry(this.window, delay, signal))
      )
        return abortedExpectationResult(isNot, signal!);

      if (signal?.aborted) return abortedExpectationResult(isNot, signal);

      lastAttempt = await this.expectOnce(selector, expression, options);
      if (lastAttempt.matches !== isNot) return { matches: !isNot };
    }

    return {
      matches: isNot,
      received: lastAttempt.received,
      timedOut: true,
      errorMessage: lastAttempt.missing
        ? "Error: element(s) not found"
        : undefined,
      log: [`waiting for locator(${JSON.stringify(selector)})`],
    };
  }

  private async expectOnce(
    selector: string,
    expression: string,
    options: Record<string, unknown>
  ): Promise<LocatorExpectationAttempt> {
    const expectOptions = options as LocatorExpectationOptions;
    const isArray =
      expression === "to.have.count" || expression.endsWith(".array");
    const elements = this.resolveAll(selector);

    if (!elements.length)
      return missingExpectationAttempt(expression, expectOptions);

    // Pinned Frame._expectInternal resolves non-array assertions strictly.
    if (!isArray && elements.length > 1)
      throw new Error(
        `strict mode violation: locator ${JSON.stringify(selector)} resolved to ${elements.length} elements`
      );

    const injectedOptions = Object.fromEntries(
      Object.entries(options).filter(
        ([key]) => key !== "timeout" && key !== "signal"
      )
    );
    // Pinned Frame.expect parses ARIA YAML before passing it across the
    // boundary to InjectedScript.expect. The compiled parser is already part
    // of this adapter's pinned artifact, so preserve that protocol here.
    if (
      expression === "to.match.aria" &&
      typeof injectedOptions.expectedValue === "string"
    )
      injectedOptions.expectedValue = parseAriaExpectation(
        injectedOptions.expectedValue
      );
    const injected = this.injected as typeof this.injected &
      ExpectCapableInjectedScript;
    const result = await injected.expect(
      elements[0],
      { expression, ...injectedOptions },
      elements
    );
    return {
      matches: result.matches,
      received: result.received,
      missing: false,
    };
  }

  // ── Terminal actions ────────────────────────────────────────────

  async clickSelector(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    options: Pick<PointerActionOptions, "position" | "trial"> & {
      clickCount?: 1 | 2;
      actionName?: "click" | "dblclick";
    } = {}
  ) {
    const actionName = options.actionName ?? "click";
    assertPointerActionOptions(actionName, {
      timeout,
      position: options.position,
      trial: options.trial,
    });
    const target = await this.retryActionability(
      selector,
      label,
      actionName,
      ["visible", "enabled", "stable"],
      true,
      deadline,
      options.position
    );

    this.assertActionDeadline(deadline, actionName);
    if (options.trial) return;

    // Playwright drives a real mouse. The browser's native activation behavior
    // runs for this single synthesized click, so do not follow it with
    // HTMLElement.click(): that would duplicate handlers and lose position
    // and click-count detail.
    this.dispatchClick(target.element, target.point, options.clickCount ?? 1);
  }

  async dblclickSelector(
    selector: string,
    label: string,
    options: PointerActionOptions = {},
    deadline = this.createActionDeadline(options.timeout)
  ): Promise<void> {
    assertPointerActionOptions("dblclick", options);
    await this.clickSelector(selector, label, options.timeout, deadline, {
      ...options,
      actionName: "dblclick",
      clickCount: 2,
    });
  }

  async fillSelector(
    selector: string,
    value: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ) {
    const { element } = await this.retryActionability(
      selector,
      label,
      "fill",
      ["visible", "enabled", "editable"],
      false,
      deadline
    );

    // Pinned InjectedScript validates input types, normalizes settable values,
    // selects the current text, and performs the direct set-value path. It
    // deliberately returns `needsinput` for ordinary text entry; Playwright's
    // server then uses the browser keyboard. We provide that final local input
    // effect below, without reimplementing InjectedScript's validation.
    this.assertActionDeadline(deadline, "fill");
    const result = this.actionableInjected.fill(element, value);
    if (result === "error:notconnected")
      throw new Error(`Element is not connected for locator ${label}`);
    if (result === "done") return;
    if (result !== "needsinput")
      throw new Error(`Unexpected fill result for locator ${label}: ${result}`);

    // InjectedScript.fill follows labels before selecting text. Apply the
    // browser-local keyboard effect to that same control, not the label.
    const inputTarget = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).retarget(element, "follow-label");
    if (!inputTarget)
      throw new Error(`Element is not connected for locator ${label}`);
    this.insertFilledText(inputTarget, value, deadline, "fill");
  }

  async pressSelector(
    selector: string,
    key: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ) {
    const element = await this.query(
      selector,
      label,
      { timeout },
      true,
      (candidate) => candidate,
      deadline
    );
    this.assertActionDeadline(deadline, "press");
    this.focusElement(element);
    await this.keyboard.press(key, {}, deadline);
  }

  async focusSelector(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<void> {
    await this.query(selector, label, options, true, (element) => {
      const result = this.actionableInjected.focusNode(element);
      if (result === "error:notconnected")
        throw new Error(`Element is not connected for locator ${label}`);
    });
  }

  async blurSelector(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<void> {
    await this.query(selector, label, options, true, (element) => {
      const result = this.actionableInjected.blurNode(element);
      if (result === "error:notconnected")
        throw new Error(`Element is not connected for locator ${label}`);
    });
  }

  async hoverSelector(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ): Promise<void> {
    const { element, point } = await this.retryActionability(
      selector,
      label,
      "hover",
      ["visible", "stable"],
      true,
      deadline
    );
    this.assertActionDeadline(deadline, "hover");
    this.dispatchPointerEvent(element, "pointerover", point, 0, 0, 0);
    this.dispatchPointerEvent(element, "pointerenter", point, 0, 0, 0, false);
    this.dispatchMouseEvent(element, "mouseover", point, 0, 0, 0);
    this.dispatchMouseEvent(element, "mouseenter", point, 0, 0, 0, false);
    this.dispatchPointerEvent(element, "pointermove", point, 0, 0, 0);
    this.dispatchMouseEvent(element, "mousemove", point, 0, 0, 0);
  }

  async setCheckedSelector(
    selector: string,
    checked: boolean,
    label: string,
    options: PointerActionOptions = {},
    deadline = this.createActionDeadline(options.timeout)
  ): Promise<void> {
    assertPointerActionOptions("setChecked", options);
    const before = await this.query(
      selector,
      label,
      { timeout: options.timeout },
      true,
      (element) => element,
      deadline
    );
    const state = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).elementState(before, "checked");
    if (state.matches === checked) return;
    if (!checked && "isRadio" in state && state.isRadio)
      throw new Error(
        "Cannot uncheck radio button. Radio buttons can only be unchecked by selecting another radio button in the same group."
      );

    this.assertActionDeadline(deadline, "click");
    await this.clickSelector(
      selector,
      label,
      options.timeout,
      deadline,
      options
    );
    if (options.trial) return;
    this.assertActionDeadline(deadline, "click");
    const after = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).elementState(this.requireSingle(selector, label), "checked");
    if (after.matches !== checked)
      throw new Error("Clicking the checkbox did not change its state");
  }

  async selectOptionSelector(
    selector: string,
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ): Promise<string[]> {
    const normalized =
      values === null ? [] : Array.isArray(values) ? values : [values];
    const options = normalized.map((value) =>
      typeof value === "string" ? { valueOrLabel: value } : value
    );
    let lastError: Error | undefined;

    while (true) {
      if (Date.now() >= deadline.expiresAt)
        throw new AdapterTimeoutError(
          `select option: Timeout ${deadline.timeout}ms exceeded.${lastError ? ` ${lastError.message}` : ""}`,
          { cause: lastError }
        );
      const { element } = await this.retryActionability(
        selector,
        label,
        "select option",
        ["visible", "enabled"],
        false,
        deadline
      );
      this.assertActionDeadline(deadline, "select option");
      const result = this.actionableInjected.selectOptions(element, options);
      if (Array.isArray(result)) return result;

      lastError =
        result === "error:optionnotenabled"
          ? new Error("Element is not enabled")
          : result === "error:notconnected"
            ? new Error(`Element is not connected for locator ${label}`)
            : new Error("Options not found");
      const remaining = deadline.expiresAt - Date.now();
      if (remaining <= 0)
        throw new AdapterTimeoutError(
          `select option: Timeout ${deadline.timeout}ms exceeded. ${lastError.message}`,
          { cause: lastError }
        );
      await this.wait(Math.min(ACTION_RETRY_DELAY, remaining));
    }
  }

  async selectText(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ): Promise<void> {
    const { element } = await this.retryActionability(
      selector,
      label,
      "select text",
      ["visible"],
      false,
      deadline
    );
    this.assertActionDeadline(deadline, "select text");
    const result = this.actionableInjected.selectText(element);
    if (result === "error:notconnected")
      throw new Error(`Element is not connected for locator ${label}`);
  }

  async scrollLocatorIntoView(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout)
  ): Promise<void> {
    const { element } = await this.retryActionability(
      selector,
      label,
      "scroll into view",
      ["stable"],
      false,
      deadline
    );
    this.assertActionDeadline(deadline, "scroll into view");
    this.scrollIntoViewIfNeeded(element);
  }

  async waitForState(
    selector: string,
    options: {
      state: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    },
    label: string
  ) {
    const timeout = this.resolveTimeout(
      options.timeout,
      DEFAULT_ACTION_TIMEOUT
    );
    try {
      await this.waitForSelectorInRoot(this.document, selector, {
        state: options.state,
        strict: true,
        timeout: options.timeout,
      });
    } catch (error) {
      if (!(error instanceof AdapterTimeoutError)) throw error;
      throw new AdapterTimeoutError(
        `locator.waitFor: Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for ${formatLocator(selector)} to be ${options.state}\n  - Timed out waiting for ${label} to become ${options.state}.`,
        { cause: error }
      );
    }
  }

  async setInputFilesSelector(
    selector: string,
    files: InputFiles,
    options: { timeout?: number; strict?: boolean } = {},
    strict = false
  ): Promise<void> {
    assertPageActionOptions("setInputFiles", options, ["strict"]);
    if (options.strict !== undefined && typeof options.strict !== "boolean")
      throw new TypeError("setInputFiles strict must be a boolean");
    const payloads = inputFilePayloads(files);
    const deadline = this.createActionDeadline(options.timeout);
    await this.query(
      selector,
      selector,
      { timeout: options.timeout },
      strict || options.strict === true,
      (element) => {
        this.assertActionDeadline(deadline, "setInputFiles");
        // Mirrors pinned server/dom.ts _setInputFiles: label retargeting and
        // input/multiple/directory validation, without visibility/enabled checks.
        const input = (
          this.injected as typeof this.injected & QueryCapableInjectedScript
        ).retarget(element, "follow-label");
        if (!input || !input.isConnected)
          throw new Error("Element is not connected");
        if (!(input instanceof this.window.HTMLInputElement))
          throw new Error("Node is not an HTMLInputElement");
        if (payloads.length > 1 && !input.multiple && !input.webkitdirectory)
          throw new Error(
            "Non-multiple file input can only accept single file"
          );
        if (input.webkitdirectory)
          throw new Error(
            "[webkitdirectory] input requires passing a path to a directory; directory uploads are not supported."
          );
        const error = this.injected.setInputFiles(input, payloads);
        if (error) throw new Error(error);
      },
      deadline
    );
  }
  // ── Setup operations ─────────────────────────────────────────────

  /**
   * Serializes the controlled document.
   *
   * Mirrors pinned b25d782 `server/frames.ts` Frame._content: serialize the
   * document type separately, then append documentElement.outerHTML. This is
   * intentionally a browser-native observation, rather than a reconstruction
   * of document-setup markup, so DOM mutations remain visible.
   */
  async content(): Promise<string> {
    let content = "";
    if (this.document.doctype)
      content = new this.window.XMLSerializer().serializeToString(
        this.document.doctype
      );
    if (this.document.documentElement)
      content += this.document.documentElement.outerHTML;
    return content;
  }

  /**
   * The browser runtime controls exactly one document, so that document is
   * also its main frame. Child-frame traversal remains unsupported.
   */
  mainFrame() {
    return this;
  }

  // ── Page compatibility façade ────────────────────────────────────

  /** Mirrors pinned Page.title by reading the controlled document title. */
  async title(): Promise<string> {
    return this.document.title;
  }

  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = validateTimeout(timeout, "Default timeout");
  }

  setDefaultNavigationTimeout(timeout: number): void {
    this.defaultNavigationTimeout = validateTimeout(
      timeout,
      "Default navigation timeout"
    );
  }

  async innerText(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string> {
    return this.query(
      selector,
      `page.innerText(${JSON.stringify(selector)})`,
      options,
      false,
      (element) => {
        if (element.namespaceURI !== "http://www.w3.org/1999/xhtml")
          throw new Error("Node is not an HTMLElement");
        return (element as HTMLElement).innerText;
      }
    );
  }

  async innerHTML(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string> {
    return this.query(
      selector,
      `page.innerHTML(${JSON.stringify(selector)})`,
      options,
      false,
      (element) => element.innerHTML
    );
  }

  async isEditable(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "editable", options, false);
  }

  async isVisible(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    assertQueryOptions(options, true);
    this.resolveTimeout(options?.timeout, DEFAULT_QUERY_TIMEOUT);
    if (options?.signal?.aborted) throw queryAborted(options.signal);

    const element = options?.strict
      ? this.resolveLocatorElement(selector, true)
      : this.resolveAll(selector)[0];
    if (!element) return false;
    return this.elementState(element, "visible").matches;
  }

  async isHidden(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return !(await this.isVisible(selector, options));
  }

  async click(selector: string, options?: PointerActionOptions): Promise<void> {
    assertPointerActionOptions("click", options);
    await this.clickSelector(
      selector,
      `page.click(${JSON.stringify(selector)})`,
      options?.timeout,
      undefined,
      options
    );
  }

  async fill(
    selector: string,
    value: string,
    options?: PageActionOptions
  ): Promise<void> {
    assertPageActionOptions("fill", options);
    await this.fillSelector(
      selector,
      value,
      `page.fill(${JSON.stringify(selector)})`,
      options?.timeout
    );
  }

  async setInputFiles(
    selector: string,
    files: InputFiles,
    options?: { timeout?: number; strict?: boolean }
  ): Promise<void> {
    await this.setInputFilesSelector(selector, files, options);
  }

  async press(
    selector: string,
    key: string,
    options?: PageActionOptions
  ): Promise<void> {
    assertPageActionOptions("press", options);
    await this.pressSelector(
      selector,
      key,
      `page.press(${JSON.stringify(selector)})`,
      options?.timeout
    );
  }

  async type(
    selector: string,
    text: string,
    options?: PageTypeOptions,
    label = `page.type(${JSON.stringify(selector)})`
  ): Promise<void> {
    assertPageActionOptions("type", options, ["delay"]);
    const deadline = this.createActionDeadline(options?.timeout);
    for (const character of text) {
      if (keyboardLayout.has(character)) {
        await this.pressSelector(
          selector,
          character,
          label,
          options?.timeout,
          deadline
        );
      } else {
        await this.insertTextSelector(selector, character, label, deadline);
      }
      if (options?.delay && options.delay > 0)
        await this.waitWithinActionDeadline(options.delay, deadline, "press");
    }
  }

  async focus(selector: string, options?: PageActionOptions): Promise<void> {
    assertPageActionOptions("focus", options);
    await this.focusSelector(
      selector,
      `page.focus(${JSON.stringify(selector)})`,
      options
    );
  }

  async hover(selector: string, options?: PageActionOptions): Promise<void> {
    assertPageActionOptions("hover", options);
    await this.hoverSelector(
      selector,
      `page.hover(${JSON.stringify(selector)})`,
      options?.timeout
    );
  }

  async selectOption(
    selector: string,
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    options?: PageActionOptions
  ): Promise<string[]> {
    assertPageActionOptions("selectOption", options);
    return this.selectOptionSelector(
      selector,
      values,
      `page.selectOption(${JSON.stringify(selector)})`,
      options?.timeout
    );
  }

  async check(selector: string, options?: PointerActionOptions): Promise<void> {
    await this.setCheckedSelector(
      selector,
      true,
      `page.check(${JSON.stringify(selector)})`,
      options
    );
  }

  async uncheck(
    selector: string,
    options?: PointerActionOptions
  ): Promise<void> {
    await this.setCheckedSelector(
      selector,
      false,
      `page.uncheck(${JSON.stringify(selector)})`,
      options
    );
  }

  async setChecked(
    selector: string,
    checked: boolean,
    options?: PointerActionOptions
  ): Promise<void> {
    await this.setCheckedSelector(
      selector,
      checked,
      `page.setChecked(${JSON.stringify(selector)})`,
      options
    );
  }

  async dblclick(
    selector: string,
    options?: PointerActionOptions
  ): Promise<void> {
    await this.dblclickSelector(
      selector,
      `page.dblclick(${JSON.stringify(selector)})`,
      options
    );
  }

  async dispatchEvent(
    selector: string,
    type: string,
    eventInit: object = {},
    options?: PageDispatchEventOptions
  ): Promise<void> {
    assertPageDispatchEventOptions(options);
    await this.dispatchEventSelector(
      selector,
      type,
      eventInit,
      `page.dispatchEvent(${JSON.stringify(selector)})`,
      options?.timeout,
      undefined,
      options?.strict === true
    );
  }

  async dispatchEventSelector(
    selector: string,
    type: string,
    eventInit: object,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    strict = true
  ): Promise<void> {
    await this.query(
      selector,
      label,
      { timeout },
      strict,
      (element) =>
        this.actionableInjected.dispatchEvent(element, type, eventInit),
      deadline
    );
  }

  /**
   * Pinned b25d782 client/frame.ts and server/frames.ts default to load,
   * wait for navigation then lifecycle, and return null for same-document
   * navigation. Location supplies the browser-side navigation here.
   * Full-document navigation ends this execution; it never resolves with a
   * fabricated Response or destination-ready result in the old document.
   * Relative URLs use document.baseURI. Custom referer, AbortSignal, and
   * networkidle are unsupported and rejected before navigation starts.
   */
  async goto(
    url: string,
    options: NonNullable<Parameters<Page["goto"]>[1]> = {}
  ): Promise<null> {
    for (const [key, value] of Object.entries(options)) {
      if (!["timeout", "waitUntil"].includes(key) && value !== undefined)
        throw new Error(`Unsupported Playwright option: goto.${key}`);
    }
    const waitUntil = options.waitUntil ?? "load";
    if (!["commit", "domcontentloaded", "load"].includes(waitUntil))
      throw new Error(`Unsupported waitUntil value: ${waitUntil}`);
    const timeout = this.resolveTimeout(
      options.timeout,
      DEFAULT_NAVIGATION_TIMEOUT,
      true
    );
    if (typeof url !== "string") throw new Error("goto URL must be a string");
    // Native relative URLs use this document's base, not a Node test config.
    const target = new URL(url, this.document.baseURI);
    if (
      !["http:", "https:", "about:", "file:", "data:"].includes(target.protocol)
    )
      throw new Error(`Unsupported navigation protocol: ${target.protocol}`);
    const current = new URL(this.window.location.href);
    const sameDocument =
      target.href.includes("#") &&
      target.href.split("#", 1)[0] === current.href.split("#", 1)[0];

    return new Promise<null>((resolve, reject) => {
      let timer: number | undefined;
      const settle = (error?: Error) => {
        this.window.clearTimeout(timer);
        this.window.removeEventListener("hashchange", check);
        this.window.removeEventListener("load", check);
        this.document.removeEventListener("readystatechange", check);
        if (error) reject(error);
        else resolve(null);
      };
      const check = () => {
        if (!sameDocument || this.window.location.href !== target.href) return;
        if (
          waitUntil === "commit" ||
          this.document.readyState === "complete" ||
          (waitUntil === "domcontentloaded" &&
            this.document.readyState === "interactive")
        )
          settle();
      };
      if (sameDocument) {
        this.window.addEventListener("hashchange", check);
        this.window.addEventListener("load", check);
        this.document.addEventListener("readystatechange", check);
      }
      // If navigation is blocked or does not replace the document (e.g. 204),
      // time out rather than claiming destination readiness. Zero disables it.
      if (timeout > 0)
        timer = this.window.setTimeout(
          () =>
            settle(
              new AdapterTimeoutError(
                `page.goto: Timeout ${timeout}ms exceeded. URL: ${target.href}`
              )
            ),
          timeout
        );
      try {
        this.window.location.assign(target.href);
        check();
      } catch (error) {
        settle(asError(error));
      }
    });
  }

  // ── Accessibility ───────────────────────────────────────────────

  /**
   * Captures the accessibility snapshot for the controlled document.
   *
   * Pinned b25d782 `Page.ariaSnapshot` delegates to the main frame. The
   * single-document adapter has that frame in-process, so it delegates
   * directly to the compiled InjectedScript which owns ARIA-tree generation
   * and rendering. There is no frame traversal or protocol transport here.
   */
  async ariaSnapshot(options: AriaSnapshotOptions = {}): Promise<string> {
    assertAriaSnapshotOptions(options);
    if (options.signal?.aborted) throw queryAborted(options.signal);
    // Protocol evaluation naturally waits for a parser-blocking resource to
    // yield. An in-process adapter call does not cross that task boundary.
    await this.waitForDocumentParser(options);

    // Pinned `ariaSnapshotForFrame` resolves `body,frameset`, rather than
    // documentElement, so the document wrapper itself is not rendered.
    return this.injectedAriaSnapshot(
      this.document.body ?? this.document.documentElement,
      options
    );
  }

  injectedAriaSnapshot(
    element: Element,
    options: AriaSnapshotOptions = {}
  ): string {
    return this.injected.ariaSnapshot(element, {
      mode: options.mode ?? "default",
      depth: options.depth,
      boxes: options.boxes,
    });
  }

  private async waitForDocumentParser(options: AriaSnapshotOptions) {
    if (this.document.readyState !== "loading") return;

    const timeout = this.resolveTimeout(options.timeout, DEFAULT_QUERY_TIMEOUT);
    await new Promise<void>((resolve, reject) => {
      let timeoutId: number | undefined;
      const settle = (error?: Error) => {
        this.window.removeEventListener("DOMContentLoaded", ready);
        options.signal?.removeEventListener("abort", aborted);
        if (timeoutId !== undefined) this.window.clearTimeout(timeoutId);
        if (error) reject(error);
        else resolve();
      };
      const ready = () => settle();
      const aborted = () => settle(queryAborted(options.signal!));

      this.window.addEventListener("DOMContentLoaded", ready, { once: true });
      options.signal?.addEventListener("abort", aborted, { once: true });
      if (timeout > 0)
        timeoutId = this.window.setTimeout(
          () =>
            settle(
              new AdapterTimeoutError(
                `page.ariaSnapshot: Timeout ${timeout}ms exceeded.`
              )
            ),
          timeout
        );
      if (this.document.readyState !== "loading") settle();
    });
  }

  // ── Evaluate / callback operations ──────────────────────────────

  /**
   * Executes a function or expression in the controlled document.
   *
   * Mirrors pinned b25d782 client/frame.ts:217-223 + server/javascript.ts:
   *   Client sends { expression: String(pageFunction),
   *                   isFunction: typeof pageFunction === 'function',
   *                   arg: serializeArgument(arg) }
   *   Server normalizes the expression, evals it once, and:
   *     isFunction=true  → calls the result with arg
   *     isFunction=false → returns the result directly
   *
   * For direct in-browser callers the function is called immediately.
   * For bridge-transported strings the isFunction flag is explicit.
   * Never retries evaluation after a runtime exception.
   */
  async evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageFunction: string | ((...a: any[]) => any),
    arg?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const isFunction = typeof pageFunction === "function";
    return this._evaluateExpression(
      isFunction ? pageFunction : String(pageFunction),
      isFunction,
      arg
    );
  }

  /**
   * Calls a browser-native callback with one strictly resolved element.
   *
   * This is the single-document equivalent of pinned Frame.$eval. It accepts
   * a function object already in the controlled runtime, so it has no
   * callback-source transport or generic-handle behavior.
   */
  async $eval<T>(
    selector: string,
    callback: (element: Element, arg?: unknown) => T | Promise<T>,
    arg?: unknown
  ): Promise<T> {
    return await callback(
      this.queryElement(
        selector,
        `page.$eval(${JSON.stringify(selector)})`,
        false
      ),
      arg
    );
  }

  /**
   * Calls a browser-native callback with every matching element.
   *
   * Pinned Frame.$$eval delegates to Locator.evaluateAll. The controlled
   * document already owns the elements, so a direct array callback preserves
   * that behavior without introducing element or JS handles.
   */
  async $$eval<T>(
    selector: string,
    callback: (elements: Element[], arg?: unknown) => T | Promise<T>,
    arg?: unknown
  ): Promise<T> {
    return await callback(this.resolveAll(selector), arg);
  }

  url(): string {
    return this.window.location.href;
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await this.wait(timeout);
  }

  /**
   * Internal expression evaluator mirroring server/javascript.ts
   * normalizeEvaluationExpression + evaluate flow.
   *
   * @param expression  String(pageFunction) or the raw function reference
   * @param isFunction  true → call the evaled result with arg;
   *                    false → return the evaled result directly
   * @param arg         serialized argument
   */
  async _evaluateExpression(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expression: string | ((...a: any[]) => any),
    isFunction: boolean,
    arg?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const unwrappedArg = this.unwrapElementHandleArg(arg);
    if (typeof expression === "function") return await expression(unwrappedArg);
    // Normalize: wrap function expressions in parens per
    // server/javascript.ts normalizeEvaluationExpression.
    const normalized = normalizeExpression(expression, isFunction);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evaled: any = this.window.eval(normalized);
    if (isFunction) return await evaled(unwrappedArg);
    return evaled;
  }

  /**
   * Polls a predicate in the controlled document until it returns a
   * truthy value.
   *
   * Mirrors pinned b25d782 server/frames.ts:1626-1694:
   *   - pollingInterval must be >0 (frames.ts:1628)
   *   - expression is normalized (frames.ts:1629)
   *   - isFunction=true  → eval once, call each poll (frames.ts:1640-1642)
   *   - isFunction=false → re-eval each poll (frames.ts:1643-1644,
   *     since evaledExpression is never cached)
   *   - abort mechanism cleans up pending timers (frames.ts:1679-1681)
   *   - timeout races independently (handles never-settling predicates)
   *
   * Returns a minimal handle with `jsonValue()` and `dispose()`,
   * mirroring pinned client JSHandle interface.
   */
  /**
   * Public API: derives isFunction from typeof pageFunction.
   */
  async waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageFunction: string | ((...a: any[]) => any),
    arg?: unknown,
    options?: { polling?: number | "raf"; timeout?: number }
  ): Promise<AdapterJSHandle> {
    return this._waitForFunctionExpression(
      typeof pageFunction === "function" ? pageFunction : String(pageFunction),
      typeof pageFunction === "function",
      arg,
      options
    );
  }

  /**
   * Internal: accepts explicit isFunction for bridge transport.
   *
   * Mirrors pinned b25d782 server/frames.ts:1626-1694:
   *   - pollingInterval must be >0 (frames.ts:1628)
   *   - expression is normalized (frames.ts:1629)
   *   - isFunction=true  → eval once, call each poll (frames.ts:1640-1642)
   *   - isFunction=false → re-eval each poll (frames.ts:1643-1644,
   *     since evaledExpression is never cached)
   *   - abort mechanism cleans up pending timers (frames.ts:1679-1681)
   *   - timeout races independently (handles never-settling predicates)
   */
  async _waitForFunctionExpression(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageFunction: string | ((...a: any[]) => any),
    isFunction: boolean,
    arg?: unknown,
    options?: { polling?: number | "raf"; timeout?: number }
  ): Promise<AdapterJSHandle> {
    const timeout = this.resolveTimeout(options?.timeout, 30_000);
    const unwrappedArg = this.unwrapElementHandleArg(arg);
    const polling = options?.polling ?? "raf";

    // Validate polling per frames.ts:1628
    if (typeof polling === "string" && polling !== "raf")
      throw new Error("Unknown polling option: " + polling);
    if (typeof polling === "number" && polling <= 0)
      throw new Error("Cannot poll with non-positive interval: " + polling);

    // For function references, call directly; for strings, normalize.
    const expression =
      typeof pageFunction === "function"
        ? pageFunction
        : normalizeExpression(String(pageFunction), isFunction);

    return new Promise<AdapterJSHandle>((resolve, reject) => {
      let aborted = false;
      let timeoutId: number | undefined;
      let pollTimerId: number | undefined;
      let rafId: number | undefined;

      // Independent timeout timer — rejects even if predicate never settles.
      if (timeout > 0) {
        timeoutId = this.window.setTimeout(() => {
          cleanup();
          reject(
            new AdapterTimeoutError(
              `page.waitForFunction: Timeout ${timeout}ms exceeded.`
            )
          );
        }, timeout);
      }

      const cleanup = () => {
        aborted = true;
        if (timeoutId !== undefined) this.window.clearTimeout(timeoutId);
        if (pollTimerId !== undefined) this.window.clearTimeout(pollTimerId);
        if (rafId !== undefined) this.window.cancelAnimationFrame(rafId);
      };

      // Cache the evaled function for isFunction=true (frames.ts:1641).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let evaledFunction: ((...a: any[]) => any) | undefined;

      const predicate = () => {
        if (typeof expression === "function") return expression(unwrappedArg);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: any = evaledFunction ?? this.window.eval(expression);
        if (isFunction) {
          evaledFunction = result;
          result = result(unwrappedArg);
        }
        // isFunction=false: result is already the expression value,
        // re-evaluated each poll because evaledFunction is never set.
        return result;
      };

      const check = () => {
        if (aborted) return;
        try {
          const result = predicate();
          if (
            result &&
            typeof (result as Promise<unknown>)?.then === "function"
          ) {
            (result as Promise<unknown>).then(
              (v) => {
                if (aborted) return;
                if (v) {
                  cleanup();
                  resolve(new AdapterJSHandle(v));
                } else {
                  scheduleNext();
                }
              },
              (e) => {
                if (aborted) return;
                cleanup();
                reject(e);
              }
            );
            return;
          }
          if (result) {
            cleanup();
            resolve(new AdapterJSHandle(result));
            return;
          }
        } catch (e) {
          cleanup();
          reject(e);
          return;
        }
        scheduleNext();
      };

      const scheduleNext = () => {
        if (aborted) return;
        if (polling === "raf") rafId = this.window.requestAnimationFrame(check);
        else pollTimerId = this.window.setTimeout(check, polling as number);
      };

      check();
    });
  }

  // ── Locator creation ────────────────────────────────────────────

  getByRole(role: string, options: ByRoleOptions = {}) {
    const roleSelector = getByRoleSelector(role, options);
    const optString =
      options.name !== undefined
        ? `, { name: ${JSON.stringify(options.name)} }`
        : "";
    return new LocatorImpl(
      this,
      roleSelector,
      `page.getByRole(${JSON.stringify(role)}${optString})`
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
      getByTestIdSelector(testIdAttributeNameFor(this.window), testId)
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

  locator(selector: string, options?: LocatorOptions) {
    return new LocatorImpl(
      this,
      selector,
      `page.locator(${JSON.stringify(selector)})`,
      options
    );
  }

  // ── Private helpers ─────────────────────────────────────────────

  private resolveTimeout(
    explicit: number | undefined,
    fallback: number,
    navigation = false
  ): number {
    if (explicit !== undefined) return validateTimeout(explicit, "Timeout");
    if (navigation && this.defaultNavigationTimeout !== undefined)
      return this.defaultNavigationTimeout;
    if (this.defaultTimeout !== undefined) return this.defaultTimeout;
    return fallback;
  }

  private createActionDeadline(timeout?: number): ActionDeadline {
    const effectiveTimeout = this.resolveTimeout(
      timeout,
      DEFAULT_ACTION_TIMEOUT
    );
    return {
      timeout: effectiveTimeout,
      expiresAt:
        effectiveTimeout === 0 ? Infinity : Date.now() + effectiveTimeout,
    };
  }

  private assertActionDeadline(
    deadline: ActionDeadline | undefined,
    actionName: string
  ) {
    if (deadline && Date.now() >= deadline.expiresAt)
      throw new AdapterTimeoutError(
        `${actionName}: Timeout ${deadline.timeout}ms exceeded.`
      );
  }

  checkKeyboardActionDeadline(deadline: ActionDeadline | undefined) {
    this.assertActionDeadline(deadline, "press");
  }

  private async waitWithinActionDeadline(
    durationMs: number | undefined,
    deadline: ActionDeadline | undefined,
    actionName: string
  ) {
    this.assertActionDeadline(deadline, actionName);
    if (!durationMs || durationMs <= 0) return;
    const remaining = deadline ? deadline.expiresAt - Date.now() : durationMs;
    await this.wait(Math.min(durationMs, remaining));
    this.assertActionDeadline(deadline, actionName);
  }

  private async wait(durationMs: number | undefined) {
    if (!durationMs || durationMs <= 0) return;
    await new Promise<void>((resolve) =>
      this.window.setTimeout(resolve, durationMs)
    );
  }

  async locatorGetAttribute(
    selector: string,
    label: string,
    name: string,
    options?: LocatorQueryOptions
  ): Promise<string | null> {
    return this.query(selector, label, options, true, (element) =>
      element.getAttribute(name)
    );
  }

  async locatorTextContent(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<string | null> {
    return this.query(
      selector,
      label,
      options,
      true,
      (element) => element.textContent
    );
  }

  async locatorInnerText(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<string> {
    return this.query(selector, label, options, true, (element) => {
      if (element.namespaceURI !== "http://www.w3.org/1999/xhtml")
        throw new Error("Node is not an HTMLElement");
      return (element as HTMLElement).innerText;
    });
  }

  async locatorInnerHTML(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<string> {
    return this.query(
      selector,
      label,
      options,
      true,
      (element) => element.innerHTML
    );
  }

  locatorAllInnerTexts(selector: string): string[] {
    return this.resolveAll(selector).map(
      (element) => (element as HTMLElement).innerText
    );
  }

  locatorAllTextContents(selector: string): string[] {
    return this.resolveAll(selector).map(
      (element) => element.textContent ?? ""
    );
  }

  async locatorInputValue(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<string> {
    return this.query(selector, label, options, true, (element) =>
      this.inputValueForElement(element)
    );
  }

  async locatorIsEnabled(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "enabled", options, true, label);
  }

  async locatorIsDisabled(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "disabled", options, true, label);
  }

  async locatorIsChecked(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "checked", options, true, label);
  }

  async locatorIsEditable(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<boolean> {
    return this.queryState(selector, "editable", options, true, label);
  }

  locatorIsVisible(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): boolean {
    assertQueryOptions(options, false);
    this.resolveTimeout(options?.timeout, DEFAULT_QUERY_TIMEOUT);
    if (options?.signal?.aborted) throw queryAborted(options.signal);

    const element = this.resolveLocatorElement(selector, true);
    if (!element) return false;
    return this.elementState(element, "visible").matches;
  }

  async locatorBoundingBox(
    selector: string,
    label: string,
    options?: LocatorQueryOptions
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.query(selector, label, options, true, (element) =>
      this.boundingBoxForElement(element)
    );
  }

  async locatorAriaSnapshot(
    selector: string,
    label: string,
    options: AriaSnapshotOptions = {}
  ): Promise<string> {
    assertAriaSnapshotOptions(options);
    if (options.signal?.aborted) throw queryAborted(options.signal);

    // The pinned server only auto-waits for the default locator snapshot.
    // AI-mode snapshots retain their immediate single-document behavior.
    if (options.mode === "ai")
      return this.injectedAriaSnapshot(
        this.queryElement(selector, label, true),
        options
      );

    return this.query(
      selector,
      label,
      { signal: options.signal, timeout: options.timeout },
      true,
      (element) => this.injectedAriaSnapshot(element, options)
    );
  }

  async locatorEvaluate<T>(
    selector: string,
    label: string,
    pageFunction: (element: Element, arg?: unknown) => T | Promise<T>,
    arg?: unknown,
    options?: LocatorQueryOptions
  ): Promise<T> {
    return this.query(selector, label, options, true, (element) =>
      pageFunction(element, arg)
    );
  }

  private async queryState(
    selector: string,
    state: QueryState,
    options: SelectorQueryOptions | LocatorQueryOptions | undefined,
    strict: boolean,
    label = `page.is${state[0].toUpperCase()}${state.slice(1)}(${JSON.stringify(selector)})`
  ): Promise<boolean> {
    return this.query(selector, label, options, strict, (element) => {
      const result = (
        this.injected as typeof this.injected & QueryCapableInjectedScript
      ).elementState(element, state);
      if (result.received === "error:notconnected")
        throw new Error("Element is not connected");
      return result.matches;
    });
  }

  inputValueForElement(element: Element): string {
    const target = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).retarget(element, "follow-label");
    if (!target) throw new Error("Element is not connected");
    if (
      !(target instanceof this.window.HTMLInputElement) &&
      !(target instanceof this.window.HTMLTextAreaElement) &&
      !(target instanceof this.window.HTMLSelectElement)
    )
      throw new Error("Node is not an <input>, <textarea> or <select> element");
    return target.value;
  }

  boundingBoxForElement(
    element: Element
  ): { x: number; y: number; width: number; height: number } | null {
    const rect = element.getBoundingClientRect();
    // A zero-sized but rendered element has a valid native box and can be
    // scrolled into view. Only a non-rendered element has no box.
    if (element.getClientRects().length === 0) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  elementStateForHandle(element: Element, state: QueryState): boolean {
    const result = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).elementState(element, state);
    if (result.received === "error:notconnected")
      throw new Error("Element is not connected");
    return result.matches;
  }

  unwrapElementHandleArg(arg: unknown): unknown {
    if (arg instanceof AdapterElementHandle)
      return arg.elementForEvaluation(this);
    return arg;
  }

  async waitForElementState(
    element: Element,
    state:
      "visible" | "hidden" | "stable" | "enabled" | "disabled" | "editable",
    options: { timeout?: number } = {}
  ): Promise<void> {
    assertElementHandleStateOptions(state, options);
    const deadline = this.createActionDeadline(options.timeout);
    const timeoutError = () =>
      new AdapterTimeoutError(
        `elementHandle.waitForElementState: Timeout ${deadline.timeout}ms exceeded.`
      );

    while (true) {
      if (deadline.expiresAt !== Infinity && Date.now() >= deadline.expiresAt)
        throw timeoutError();
      const matches = await this.waitForActionDeadline(
        this.elementMatchesState(element, state),
        deadline,
        timeoutError
      );
      if (matches) return;
      if (deadline.expiresAt !== Infinity && Date.now() >= deadline.expiresAt)
        throw timeoutError();
      await this.wait(
        deadline.expiresAt === Infinity
          ? 10
          : Math.min(10, deadline.expiresAt - Date.now())
      );
    }
  }

  private async waitForSelectorInRoot(
    root: Document | Element,
    selector: string,
    options: WaitForSelectorOptions,
    allowsStrict = true
  ): Promise<AdapterElementHandle | null> {
    assertWaitForSelectorOptions(options, allowsStrict);
    const state = options.state ?? "visible";
    const timeout = this.resolveTimeout(
      options.timeout,
      DEFAULT_ACTION_TIMEOUT
    );
    const deadline = timeout === 0 ? Infinity : Date.now() + timeout;

    while (true) {
      const element =
        root instanceof this.window.Element
          ? this.resolveWithinElement(root, selector, options.strict === true)
          : this.resolveLocatorElement(selector, options.strict === true);
      const visible =
        !!element && this.elementState(element, "visible").matches === true;
      if ((state === "attached" && element) || (state === "visible" && visible))
        return this.elementHandleFor(element);
      if (
        (state === "detached" && !element) ||
        (state === "hidden" && !visible)
      )
        return null;

      if (Date.now() >= deadline)
        throw new AdapterTimeoutError(
          `page.waitForSelector: Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for ${formatLocator(selector)} to be ${state}`
        );
      await this.wait(Math.min(QUERY_RETRY_DELAY, deadline - Date.now()));
    }
  }

  private async elementMatchesState(
    element: Element,
    state: "visible" | "hidden" | "stable" | "enabled" | "disabled" | "editable"
  ): Promise<boolean> {
    if (state === "hidden")
      return (
        !element.isConnected ||
        this.elementState(element, "visible").matches !== true
      );
    if (!element.isConnected) throw new Error("Element is not connected");
    if (state === "visible")
      return this.elementState(element, "visible").matches === true;
    if (state === "stable") {
      const result = await this.actionableInjected.checkElementStates(element, [
        "stable",
      ]);
      if (result === "error:notconnected")
        throw new Error("Element is not connected");
      return !result;
    }
    const result = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).elementState(element, state);
    if (result.received === "error:notconnected")
      throw new Error("Element is not connected");
    return result.matches;
  }

  private async query<T>(
    selector: string,
    label: string,
    options: SelectorQueryOptions | LocatorQueryOptions | undefined,
    strict: boolean,
    evaluate: (element: Element) => T | Promise<T>,
    actionDeadline?: ActionDeadline
  ): Promise<T> {
    assertQueryOptions(options, !strict);
    const timeout =
      actionDeadline?.timeout ??
      this.resolveTimeout(options?.timeout, DEFAULT_QUERY_TIMEOUT);
    const signal = options?.signal;
    if (signal?.aborted) throw queryAborted(signal);
    const deadline =
      actionDeadline?.expiresAt ??
      (timeout === 0 ? Infinity : Date.now() + timeout);

    while (true) {
      try {
        const element = this.queryElement(
          selector,
          label,
          strict ||
            (options as SelectorQueryOptions | undefined)?.strict === true
        );
        return await evaluate(element);
      } catch (error) {
        if (!isRetryableQueryError(error)) throw error;
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new AdapterTimeoutError(
            `Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for ${formatLocator(selector)}`,
            { cause: error }
          );
        const delay = Math.min(QUERY_RETRY_DELAY, remaining);
        if (!(await waitForExpectationRetry(this.window, delay, signal)))
          throw queryAborted(signal!);
      }
    }
  }

  private queryElement(selector: string, label: string, strict: boolean) {
    const element = this.resolveLocatorElement(selector, strict);
    if (!element) throw new Error(`No elements found for locator ${label}`);
    return element;
  }

  private resolveLocatorElement(
    selector: string,
    strict: boolean
  ): Element | undefined {
    try {
      const parsed = this.injected.parseSelector(selector);
      return this.injected.querySelector(parsed, this.document, strict);
    } catch (error) {
      throw presentOriginalXPath(error, selector);
    }
  }

  private async ensureActionable(
    element: Element,
    states: ("visible" | "enabled" | "editable" | "stable")[],
    deadline?: ActionDeadline
  ) {
    const result = await this.waitForActionDeadline(
      this.actionableInjected.checkElementStates(element, states),
      deadline,
      () => this.actionabilityDeadlineError(element, states)
    );
    if (!result) return;
    if (result === "error:notconnected")
      throw new Error("Element is not connected");
    throw new Error(`Element is not ${result.missingState}`);
  }

  private async waitForActionDeadline<T>(
    operation: Promise<T>,
    deadline: ActionDeadline | undefined,
    timeoutError: () => Error
  ): Promise<T> {
    if (!deadline || deadline.expiresAt === Infinity) return operation;
    if (Date.now() >= deadline.expiresAt) throw timeoutError();

    let timeoutHandle: number | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        // Pinned stability checks wait for requestAnimationFrame. They only
        // inspect an element, so ending our await cannot cause a late input
        // action; the pinned primitive exposes no cancellation handle.
        timeoutHandle = this.window.setTimeout(
          () => reject(timeoutError()),
          Math.max(0, deadline.expiresAt - Date.now())
        );
        operation.then(resolve, reject);
      });
    } finally {
      if (timeoutHandle !== undefined) this.window.clearTimeout(timeoutHandle);
    }
  }

  private actionabilityDeadlineError(
    element: Element,
    states: ("visible" | "enabled" | "editable" | "stable")[]
  ): Error {
    if (!element.isConnected) return new Error("Element is not connected");
    if (
      states.includes("visible") &&
      !this.elementState(element, "visible").matches
    )
      return new Error("Element is not visible");

    const injected = this.injected as typeof this.injected &
      QueryCapableInjectedScript;
    for (const state of ["enabled", "editable"] as const) {
      if (!states.includes(state)) continue;
      const result = injected.elementState(element, state);
      if (result.received === "error:notconnected")
        return new Error("Element is not connected");
      if (!result.matches) return new Error(`Element is not ${state}`);
    }
    return new Error("Element is not stable");
  }

  private async retryActionability(
    selector: string,
    label: string,
    actionName:
      | "click"
      | "dblclick"
      | "fill"
      | "hover"
      | "select option"
      | "select text"
      | "scroll into view",
    states: ("visible" | "enabled" | "editable" | "stable")[],
    checkHitTarget: boolean,
    deadline: ActionDeadline,
    position?: ActionPoint
  ): Promise<ActionTarget> {
    let lastError: Error | undefined;
    const throwTimeout = () => {
      if (lastError)
        throw new AdapterTimeoutError(
          `${actionName}: Timeout ${deadline.timeout}ms exceeded. ${lastError.message}`,
          { cause: lastError }
        );
      this.assertActionDeadline(deadline, actionName);
    };

    while (true) {
      if (Date.now() >= deadline.expiresAt) throwTimeout();
      try {
        const element = this.requireSingle(selector, label);
        await this.ensureActionable(element, states, deadline);
        if (Date.now() >= deadline.expiresAt) throwTimeout();
        if (actionName !== "scroll into view")
          this.scrollIntoView(element, position);
        // Scrolling can change visibility or expose a covering element.
        await this.ensureActionable(element, states, deadline);
        const point = checkHitTarget
          ? this.ensureReceivesEvents(element, position)
          : actionPoint(element, position, this.window);
        if (Date.now() >= deadline.expiresAt) throwTimeout();
        return { element, point };
      } catch (error) {
        if (!isRetryableActionError(error)) throw error;
        lastError = asError(error);
        const remaining = deadline.expiresAt - Date.now();
        if (remaining <= 0)
          throw new AdapterTimeoutError(
            `${actionName}: Timeout ${deadline.timeout}ms exceeded. ${lastError.message}`,
            { cause: error }
          );
        await this.wait(Math.min(ACTION_RETRY_DELAY, remaining));
      }
    }
  }

  private scrollIntoView(element: Element, position?: ActionPoint) {
    if (typeof element.scrollIntoView !== "function") return;
    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "instant",
    });
    if (!position) return;

    // Pinned ElementHandle._performPointerAction scrolls the requested point,
    // not the whole element. DOM scrollIntoView has no rectangle parameter;
    // adjust each containing scrollport, then the viewport, from inside out.
    for (let node = element.parentNode; node; node = node.parentNode) {
      if (node instanceof ShadowRoot) node = node.host;
      if (!(node instanceof Element) || node === this.document.scrollingElement)
        continue;
      const point = actionPoint(element, position, this.window);
      const bounds = node.getBoundingClientRect();
      const left = bounds.left + node.clientLeft;
      const top = bounds.top + node.clientTop;
      node.scrollBy({
        left:
          point.x < left || point.x >= left + node.clientWidth
            ? point.x - left - node.clientWidth / 2
            : 0,
        top:
          point.y < top || point.y >= top + node.clientHeight
            ? point.y - top - node.clientHeight / 2
            : 0,
        behavior: "instant",
      });
    }
    const point = actionPoint(element, position, this.window);
    const width = this.document.documentElement.clientWidth;
    const height = this.document.documentElement.clientHeight;
    this.window.scrollBy({
      left: point.x < 0 || point.x >= width ? point.x - width / 2 : 0,
      top: point.y < 0 || point.y >= height ? point.y - height / 2 : 0,
      behavior: "instant",
    });
  }

  private scrollIntoViewIfNeeded(element: Element) {
    const nativeScrollIntoViewIfNeeded = (
      element as Element & { scrollIntoViewIfNeeded?: () => void }
    ).scrollIntoViewIfNeeded;
    if (typeof nativeScrollIntoViewIfNeeded === "function") {
      nativeScrollIntoViewIfNeeded.call(element);
      return;
    }
    this.scrollIntoView(element);
  }

  private ensureReceivesEvents(
    element: Element,
    position?: ActionPoint
  ): ActionPoint {
    const rect = element.getBoundingClientRect();
    // Layoutless DOM environments have no meaningful hit point. The pinned
    // primitive remains the authority whenever a browser supplies geometry.
    const point = actionPoint(element, position, this.window);
    if (
      !rect.width ||
      !rect.height ||
      typeof this.document.elementFromPoint !== "function"
    )
      return point;
    const result = this.actionableInjected.expectHitTarget(point, element);
    if (result !== "done")
      throw new Error(
        `Element does not receive pointer events: ${result.hitTargetDescription}`
      );
    return point;
  }

  private dispatchClick(
    element: Element,
    point: ActionPoint,
    clickCount: 1 | 2
  ) {
    const target = this.eventTargetAtPoint(element, point);
    this.dispatchPointerEvent(target, "pointerover", point, 0, 0, 0);
    this.dispatchPointerEvent(target, "pointerenter", point, 0, 0, 0, false);
    this.dispatchMouseEvent(target, "mouseover", point, 0, 0, 0);
    this.dispatchMouseEvent(target, "mouseenter", point, 0, 0, 0, false);
    this.dispatchPointerEvent(target, "pointermove", point, 0, 0, 0);
    this.dispatchMouseEvent(target, "mousemove", point, 0, 0, 0);

    for (let detail = 1; detail <= clickCount; detail++) {
      const pointerDownAllowed = this.dispatchPointerEvent(
        target,
        "pointerdown",
        point,
        0,
        1,
        0
      );
      if (pointerDownAllowed) {
        const mouseDownAllowed = this.dispatchMouseEvent(
          target,
          "mousedown",
          point,
          0,
          1,
          detail
        );
        if (mouseDownAllowed) this.focusElement(target);
      }
      this.dispatchPointerEvent(target, "pointerup", point, 0, 0, 0);
      if (pointerDownAllowed)
        this.dispatchMouseEvent(target, "mouseup", point, 0, 0, detail);

      this.dispatchMouseEvent(target, "click", point, 0, 0, detail);
    }
    if (clickCount === 2)
      this.dispatchMouseEvent(target, "dblclick", point, 0, 0, 2);
  }

  private eventTargetAtPoint(element: Element, point: ActionPoint): Element {
    const target = this.document.elementFromPoint?.(point.x, point.y);
    return target && element.contains(target) ? target : element;
  }

  private focusElement(element: Element) {
    this.actionableInjected.focusNode(element, true);
  }

  private insertFilledText(
    element: Element,
    value: string,
    deadline: ActionDeadline,
    actionName: string
  ) {
    if (isFillableInputWithoutSelection(element, this.window)) {
      // Pinned InjectedScript has already validated and selected this input.
      // Its browser keyboard path cannot be represented with setRangeText:
      // these fillable input types deliberately do not support selection APIs.
      this.assertActionDeadline(deadline, actionName);
      element.value = isNumberInput(element, this.window)
        ? value.trim()
        : value;
      this.dispatchInputEvent(element);
      return;
    }

    this.assertActionDeadline(deadline, actionName);
    this.replaceSelectedText(element, value);
  }

  insertPressedText(
    element: Element,
    text: string,
    inputType = "insertText",
    eventData: string | null = text,
    deadline?: ActionDeadline
  ) {
    this.assertActionDeadline(deadline, "press");
    if (!isEditableElement(element, this.window)) return;
    if (isFillableInputWithoutSelection(element, this.window)) {
      element.value += text;
      this.dispatchInputEvent(element, eventData, inputType);
      return;
    }
    this.replaceSelectedText(element, text, inputType, eventData);
  }

  insertKeyboardText(
    element: Element,
    text: string,
    inputType = "insertText",
    eventData: string | null = text,
    deadline?: ActionDeadline
  ) {
    this.assertActionDeadline(deadline, "press");
    if (!isEditableElement(element, this.window)) return;
    if (!this.dispatchBeforeInput(element, eventData, inputType)) return;
    this.assertActionDeadline(deadline, "press");
    this.insertPressedText(element, text, inputType, eventData, deadline);
  }

  private async insertTextSelector(
    selector: string,
    text: string,
    label: string,
    deadline: ActionDeadline
  ) {
    const element = await this.query(
      selector,
      label,
      { timeout: deadline.timeout },
      true,
      (candidate) => candidate,
      deadline
    );
    this.assertActionDeadline(deadline, "press");
    this.focusElement(element);
    this.insertKeyboardText(element, text, "insertText", text, deadline);
  }

  pressEnter(element: Element, deadline?: ActionDeadline) {
    this.assertActionDeadline(deadline, "press");
    if (isHtmlButton(element, this.window)) {
      element.click();
      return;
    }
    if (isInputButton(element, this.window)) {
      element.click();
      return;
    }
    if (isTextControl(element, this.window)) {
      element.form?.requestSubmit();
      return;
    }
    if (isTextArea(element, this.window) || isContentEditable(element))
      this.insertKeyboardText(element, "\n", "insertLineBreak", null, deadline);
  }

  applyKeydownDefault(
    element: Element,
    target: KeyboardKeyDescription,
    modifiers: Set<string>
  ) {
    const primaryModifier = modifiers.has("Control") || modifiers.has("Meta");
    if (primaryModifier && !modifiers.has("Alt") && target.code === "KeyA") {
      this.selectEditableText(element);
      return;
    }
  }

  applyKeyupDefault(
    element: Element,
    target: KeyboardKeyDescription,
    modifiers: Set<string>
  ) {
    if (
      target.code === "Space" &&
      modifiers.size === 0 &&
      isSpaceActivatable(element, this.window)
    )
      element.click();
  }

  private selectEditableText(element: Element) {
    if (
      isSelectionCapableInput(element, this.window) ||
      isTextArea(element, this.window)
    ) {
      element.select();
      return;
    }
    if (!isContentEditable(element)) return;
    const range = this.document.createRange();
    range.selectNodeContents(element);
    const selection = this.window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private replaceSelectedText(
    element: Element,
    text: string,
    inputType = "insertText",
    eventData: string | null = text
  ) {
    if (isTextInput(element, this.window) || isTextArea(element, this.window)) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      element.setRangeText(text, start, end, "end");
      this.dispatchInputEvent(element, eventData, inputType);
      return;
    }
    if (isContentEditable(element)) {
      // InjectedScript.selectText has selected the whole content for fill.
      // For press, the DOM Selection API is not reliable in every host, so a
      // single text node is the intentionally limited editable representation.
      const selection = this.window.getSelection();
      if (selection?.rangeCount && selection.containsNode(element, true)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(this.document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        element.textContent = `${element.textContent ?? ""}${text}`;
      }
      this.dispatchInputEvent(element, eventData, inputType);
      return;
    }
    throw new Error("Element is not editable");
  }

  private dispatchBeforeInput(
    element: Element,
    data: string | null,
    inputType: string
  ): boolean {
    const InputEvent = this.window.InputEvent;
    if (!InputEvent) return true;
    return element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data,
        inputType,
      })
    );
  }

  private dispatchInputEvent(
    element: Element,
    data: string | null = null,
    inputType = "insertText"
  ) {
    const InputEvent = this.window.InputEvent;
    element.dispatchEvent(
      InputEvent
        ? new InputEvent("input", {
            bubbles: true,
            composed: true,
            data,
            inputType,
          })
        : new this.window.Event("input", { bubbles: true, composed: true })
    );
  }

  private dispatchPointerEvent(
    element: Element,
    type: string,
    point: ActionPoint,
    button: number,
    buttons: number,
    detail: number,
    bubbles = true
  ): boolean {
    const PointerEvent = this.window.PointerEvent ?? this.window.Event;
    return element.dispatchEvent(
      new PointerEvent(type, {
        bubbles,
        button,
        buttons,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        composed: true,
        detail,
      })
    );
  }

  private dispatchMouseEvent(
    element: Element,
    type: string,
    point: ActionPoint,
    button: number,
    buttons: number,
    detail: number,
    bubbles = true
  ): boolean {
    return element.dispatchEvent(
      new this.window.MouseEvent(type, {
        bubbles,
        button,
        buttons,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        composed: true,
        detail,
      })
    );
  }

  dispatchKeyboardEvent(
    element: Element,
    type: "keydown" | "keypress" | "keyup",
    description: KeyboardKeyDescription,
    modifiers: Set<string>,
    repeat = false
  ): boolean {
    const charCode =
      type === "keypress" && description.text
        ? description.text.charCodeAt(0)
        : 0;
    const keyCode =
      type === "keypress" ? charCode : description.keyCodeWithoutLocation;
    const event = new this.window.KeyboardEvent(type, {
      key: description.key,
      code: description.code,
      keyCode,
      charCode,
      which: keyCode,
      location: description.location,
      bubbles: true,
      cancelable: true,
      composed: true,
      altKey: modifiers.has("Alt"),
      ctrlKey: modifiers.has("Control"),
      metaKey: modifiers.has("Meta"),
      repeat,
      shiftKey: modifiers.has("Shift"),
    });
    // Chromium exposes these legacy properties from the protocol event. The
    // DOM implementation used by the controlled browser does not honor the
    // KeyboardEventInit members, so retain the pinned description explicitly.
    Object.defineProperties(event, {
      keyCode: { configurable: true, value: keyCode },
      charCode: { configurable: true, value: charCode },
      which: { configurable: true, value: keyCode },
    });
    return element.dispatchEvent(event);
  }

  private get actionableInjected() {
    return this.injected as typeof this.injected & ActionableInjectedScript;
  }
}

/**
 * Browser-only analogue of pinned `server/input.ts` Keyboard. It deliberately
 * owns only synthetic event/input behavior in the current document; browser
 * cursor movement, deletion, focus traversal, and navigation defaults remain
 * outside this adapter's supported default-action surface.
 */
class BrowserKeyboard {
  private readonly pressedKeys = new Set<string>();
  private readonly pressedModifiers = new Set<string>();
  private readonly keydownState = new Map<
    string,
    { allowed: boolean; target: Element }
  >();

  constructor(private readonly page: PageImpl) {}

  async down(key: string, deadline?: ActionDeadline): Promise<void> {
    await this.downForTarget(key, deadline);
  }

  async up(key: string, deadline?: ActionDeadline): Promise<void> {
    await this.upForTarget(key, deadline);
  }

  async insertText(text: string): Promise<void> {
    this.page.insertKeyboardText(this.activeTarget(), text);
  }

  async type(text: string, options: { delay?: number } = {}): Promise<void> {
    const delay = options.delay || undefined;
    for (const character of text) {
      if (keyboardLayout.has(character)) await this.press(character, { delay });
      else {
        if (delay) await this.wait(delay);
        await this.insertText(character);
      }
    }
  }

  async press(
    key: string,
    options: { delay?: number } = {},
    deadline?: ActionDeadline
  ): Promise<void> {
    const tokens = splitKeyboardShortcut(key);
    const target = tokens.at(-1)!;
    for (const modifier of tokens.slice(0, -1))
      await this.down(modifier, deadline);
    await this.down(target, deadline);
    if (options.delay) await this.wait(options.delay, deadline);
    await this.up(target, deadline);
    for (const modifier of tokens.slice(0, -1).reverse())
      await this.up(modifier, deadline);
  }

  private async downForTarget(
    key: string,
    deadline?: ActionDeadline
  ): Promise<void> {
    this.page.checkKeyboardActionDeadline(deadline);
    const description = this.descriptionFor(key);
    const repeat = this.pressedKeys.has(description.code);
    this.pressedKeys.add(description.code);
    if (isModifier(description.key)) this.pressedModifiers.add(description.key);

    const keyDownTarget = this.activeTarget();
    const keyDownAllowed = this.page.dispatchKeyboardEvent(
      keyDownTarget,
      "keydown",
      description,
      this.pressedModifiers,
      repeat
    );
    this.keydownState.set(description.code, {
      allowed: keyDownAllowed,
      target: keyDownTarget,
    });
    await this.waitForKeyboardPhase(deadline);
    const dispatchKeyPress =
      keyDownAllowed &&
      (description.text.length > 0 || description.key === "Enter");
    this.page.checkKeyboardActionDeadline(deadline);
    const keyPressAllowed =
      dispatchKeyPress &&
      this.page.dispatchKeyboardEvent(
        this.activeTarget(),
        "keypress",
        description,
        this.pressedModifiers,
        repeat
      );

    if (keyDownAllowed)
      this.page.applyKeydownDefault(
        this.activeTarget(),
        description,
        this.pressedModifiers
      );
    if (dispatchKeyPress) await this.waitForKeyboardPhase(deadline);
    if (keyPressAllowed && description.text && description.key !== "Enter") {
      this.page.checkKeyboardActionDeadline(deadline);
      this.page.insertKeyboardText(
        this.activeTarget(),
        description.text,
        "insertText",
        description.text,
        deadline
      );
    }
    if (keyPressAllowed && description.key === "Enter") {
      this.page.checkKeyboardActionDeadline(deadline);
      this.page.pressEnter(this.activeTarget(), deadline);
    }
  }

  private async upForTarget(
    key: string,
    deadline?: ActionDeadline
  ): Promise<void> {
    this.page.checkKeyboardActionDeadline(deadline);
    const description = this.descriptionFor(key);
    if (isModifier(description.key))
      this.pressedModifiers.delete(description.key);
    this.pressedKeys.delete(description.code);
    const keyUpTarget = this.activeTarget();
    const keyUpAllowed = this.page.dispatchKeyboardEvent(
      keyUpTarget,
      "keyup",
      description,
      this.pressedModifiers
    );
    const keyDownState = this.keydownState.get(description.code);
    this.keydownState.delete(description.code);
    await this.waitForKeyboardPhase(deadline);
    if (
      keyDownState?.allowed &&
      keyUpAllowed &&
      keyUpTarget === keyDownState.target &&
      this.activeTarget() === keyDownState.target
    )
      this.page.applyKeyupDefault(
        keyDownState.target,
        description,
        this.pressedModifiers
      );
  }

  private activeTarget(): Element {
    let target = this.page.document.activeElement ?? this.page.document.body;
    while (
      target.shadowRoot?.mode === "open" &&
      target.shadowRoot.activeElement
    )
      target = target.shadowRoot.activeElement;
    return target;
  }

  private descriptionFor(key: string): KeyboardKeyDescription {
    const resolved = resolveKeyboardKey(key, this.page.window);
    let description = keyboardLayout.get(resolved);
    if (!description) throw new Error(`Unknown key: "${resolved}"`);
    if (this.pressedModifiers.has("Shift") && description.shifted)
      description = description.shifted;
    if (
      this.pressedModifiers.size > 1 ||
      (!this.pressedModifiers.has("Shift") && this.pressedModifiers.size === 1)
    )
      return { ...description, text: "" };
    return description;
  }

  private async wait(delay: number, deadline?: ActionDeadline): Promise<void> {
    this.page.checkKeyboardActionDeadline(deadline);
    const remaining = deadline
      ? Math.max(0, deadline.expiresAt - Date.now())
      : delay;
    if (deadline && remaining <= 0)
      this.page.checkKeyboardActionDeadline(deadline);
    await new Promise<void>((resolve) =>
      this.page.window.setTimeout(resolve, Math.min(delay, remaining))
    );
    this.page.checkKeyboardActionDeadline(deadline);
  }

  private async waitForKeyboardPhase(deadline?: ActionDeadline): Promise<void> {
    this.page.checkKeyboardActionDeadline(deadline);
    // Chromium completes nested microtasks from one input dispatch before the
    // next DevTools input command is handled. A single Promise.resolve() only
    // yields one queued continuation, so it misses microtasks queued by other
    // microtasks. Crossing a timer task flushes that complete microtask turn.
    await new Promise<void>((resolve) => this.page.window.setTimeout(resolve));
    this.page.checkKeyboardActionDeadline(deadline);
  }
}

function splitKeyboardShortcut(key: string): string[] {
  const tokens: string[] = [];
  let building = "";
  for (const character of key) {
    if (character === "+" && building) {
      tokens.push(building);
      building = "";
    } else {
      building += character;
    }
  }
  tokens.push(building);
  if (!tokens.length || tokens.some((token) => !token)) unknownKey(key);
  for (const modifier of tokens.slice(0, -1)) {
    const description = keyboardLayout.get(resolveKeyboardKey(modifier));
    if (!description || !isModifier(description.key)) unknownKey(key);
  }
  return tokens;
}

function resolveKeyboardKey(
  key: string,
  browserWindow?: Window & typeof globalThis
): string {
  if (key !== "ControlOrMeta") return key;
  return browserWindow && /Mac/.test(browserWindow.navigator.platform)
    ? "Meta"
    : "Control";
}

// ── Helpers ─────────────────────────────────────────────────────────

function expectationTimeout(timeout: unknown): number {
  if (typeof timeout !== "number") return DEFAULT_EXPECT_TIMEOUT;
  return Math.max(0, timeout);
}

function expectationBackoff(timeout: number, retryIndex: number): number {
  const backoff =
    EXPECT_RETRY_BACKOFF[Math.min(retryIndex, EXPECT_RETRY_BACKOFF.length - 1)];
  return Math.min(backoff, Math.max(1, timeout / 5));
}

function missingExpectationAttempt(
  expression: string,
  options: LocatorExpectationOptions
): LocatorExpectationAttempt {
  const isNot = !!options.isNot;

  if (expression === "to.have.count") {
    return {
      matches: options.expectedNumber === 0,
      received: { value: 0 },
      missing: false,
    };
  }

  if (expression.endsWith(".array")) {
    const expectedText = options.expectedText;
    return {
      matches: !Array.isArray(expectedText) || expectedText.length === 0,
      received: { value: [] },
      missing: false,
    };
  }

  if (
    (!isNot &&
      (expression === "to.be.hidden" || expression === "to.be.detached")) ||
    (isNot &&
      (expression === "to.be.visible" ||
        expression === "to.be.attached" ||
        expression === "to.be.in.viewport"))
  ) {
    return { matches: !isNot, missing: false };
  }

  return { matches: isNot, missing: true };
}

function abortedExpectationResult(
  isNot: boolean,
  signal: AbortSignal
): LocatorExpectationResult {
  return {
    matches: isNot,
    errorMessage: `Error: The assertion was aborted: ${abortReason(signal)}`,
    log: ["operation was aborted"],
  };
}

function abortReason(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return reason === undefined ? "This operation was aborted" : String(reason);
}

function waitForExpectationRetry(
  browserWindow: Window & typeof globalThis,
  delay: number,
  signal?: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (completed: boolean) => {
      browserWindow.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timeoutId = browserWindow.setTimeout(() => finish(true), delay);

    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function centerPoint(element: Element): ActionPoint {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function actionPoint(
  element: Element,
  position: ActionPoint | undefined,
  browserWindow: Window & typeof globalThis
): ActionPoint {
  if (!position) return centerPoint(element);
  const rect = element.getBoundingClientRect();
  const style = browserWindow.getComputedStyle(element);
  // Pinned ElementHandle._offsetPoint measures user positions from the
  // padding box, after the element's border.
  return {
    x: rect.left + parseFloat(style.borderLeftWidth) + position.x,
    y: rect.top + parseFloat(style.borderTopWidth) + position.y,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRetryableActionError(error: unknown): boolean {
  const message = asError(error).message;
  return (
    message.startsWith("No elements found for locator") ||
    message === "Element is not connected" ||
    message.startsWith("Element is not ") ||
    message.startsWith("Element does not receive pointer events")
  );
}

function queryTimeout(timeout: unknown): number {
  if (timeout === undefined) return DEFAULT_QUERY_TIMEOUT;
  return validateTimeout(timeout, "Query timeout");
}

function validateTimeout(timeout: unknown, name: string): number {
  if (typeof timeout !== "number" || timeout < 0 || !Number.isFinite(timeout))
    throw new TypeError(`${name} must be a non-negative finite number`);
  return timeout;
}

function assertPageActionOptions(
  method: string,
  options: Record<string, unknown> | undefined,
  supported: string[] = []
): void {
  if (!options) return;
  const unsupported = Object.keys(options).filter(
    (key) =>
      options[key] !== undefined &&
      key !== "timeout" &&
      !supported.includes(key)
  );
  if (unsupported.length > 0)
    throw new Error(
      `${method}(): unsupported options: ${unsupported.join(", ")}. ` +
        `Unsupported Playwright option(s) are not supported by the single-document adapter.`
    );
  if (options.timeout !== undefined)
    validateTimeout(options.timeout, `${method} timeout`);
}

type PageDispatchEventOptions = PageActionOptions & { strict?: boolean };

function assertPageDispatchEventOptions(
  options: PageDispatchEventOptions | undefined
): void {
  assertPageActionOptions("dispatchEvent", options, ["strict"]);
  if (options?.strict !== undefined && typeof options.strict !== "boolean")
    throw new TypeError("dispatchEvent strict must be a boolean");
}

function assertPointerActionOptions(
  method: string,
  options: PointerActionOptions | undefined
): void {
  assertPageActionOptions(method, options, ["position", "trial"]);
  if (options?.trial !== undefined && typeof options.trial !== "boolean")
    throw new TypeError(`${method} trial must be a boolean`);
  if (options?.position === undefined) return;
  const { x, y } = options.position;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  )
    throw new TypeError(`${method} position must have finite x and y numbers`);
}

function assertAriaSnapshotOptions(options: AriaSnapshotOptions) {
  queryTimeout(options.timeout);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError("ARIA snapshot signal must be an AbortSignal");
}

function assertQueryOptions(
  options: SelectorQueryOptions | LocatorQueryOptions | undefined,
  allowsStrict: boolean
) {
  if (!options) return;
  for (const key of Object.keys(options)) {
    if (
      key !== "signal" &&
      key !== "timeout" &&
      !(allowsStrict && key === "strict")
    )
      throw new Error(`Unsupported query option: ${key}`);
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError("Query signal must be an AbortSignal");
  if (!allowsStrict && "strict" in options)
    throw new Error("Locator query options do not support strict");
}

function assertDollarOptions(options: Pick<SelectorQueryOptions, "strict">) {
  for (const key of Object.keys(options)) {
    if (key !== "strict") throw new Error(`Unsupported query option: ${key}`);
  }
}

function assertWaitForSelectorOptions(
  options: WaitForSelectorOptions,
  allowsStrict: boolean
) {
  for (const key of Object.keys(options)) {
    if (
      key !== "state" &&
      key !== "timeout" &&
      !(allowsStrict && key === "strict")
    )
      throw new Error(`Unsupported waitForSelector option: ${key}`);
  }
  if (!allowsStrict && "strict" in options)
    throw new Error("ElementHandle waitForSelector does not support strict");
  if (
    options.state !== undefined &&
    !["attached", "detached", "visible", "hidden"].includes(options.state)
  )
    throw new Error(`Unsupported waitForSelector state: ${options.state}`);
  if (options.timeout !== undefined)
    validateTimeout(options.timeout, "waitForSelector timeout");
}

function assertElementHandleStateOptions(
  state: string,
  options: { timeout?: number }
) {
  if (
    ![
      "visible",
      "hidden",
      "stable",
      "enabled",
      "disabled",
      "editable",
    ].includes(state)
  )
    throw new Error(`Unsupported element state: ${state}`);
  for (const key of Object.keys(options)) {
    if (key !== "timeout")
      throw new Error(`Unsupported waitForElementState option: ${key}`);
  }
  if (options.timeout !== undefined)
    validateTimeout(options.timeout, "waitForElementState timeout");
}

function isRetryableQueryError(error: unknown): boolean {
  const message = asError(error).message;
  return (
    message.startsWith("No elements found for locator") ||
    message === "Element is not connected"
  );
}

function formatLocator(selector: string): string {
  return `locator('${selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')`;
}

function presentOriginalXPath(error: unknown, selector: string): Error {
  const source = asError(error);
  if (!selector.startsWith("//")) return source;
  // The browser evaluates implicit XPath as a relative expression in some
  // engines. Playwright reports the caller's expression, with embedded quotes
  // escaped as they appear in its selector diagnostics.
  const originalXPath = selector.replaceAll("'", "\\'");
  const rewritten = source.message
    .replaceAll(`.${selector}`, originalXPath)
    .replaceAll(selector, originalXPath);
  if (rewritten === source.message) return source;
  return new Error(rewritten, { cause: source });
}

function queryAborted(signal: AbortSignal): Error {
  return new Error(`Query was aborted: ${abortReason(signal)}`);
}

function unknownKey(value: string): never {
  throw new Error(`Unknown key: "${value}"`);
}

function isModifier(key: string): boolean {
  return (
    key === "Alt" || key === "Control" || key === "Meta" || key === "Shift"
  );
}

function isTextInput(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLInputElement {
  return element instanceof browserWindow.HTMLInputElement;
}

function isNumberInput(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLInputElement {
  return (
    isTextInput(element, browserWindow) &&
    element.type.toLowerCase() === "number"
  );
}

function isSelectionCapableInput(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLInputElement {
  return (
    isTextInput(element, browserWindow) &&
    ["password", "search", "tel", "text", "url"].includes(
      element.type.toLowerCase()
    )
  );
}

function isFillableInputWithoutSelection(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLInputElement {
  return (
    isTextInput(element, browserWindow) &&
    !isSelectionCapableInput(element, browserWindow)
  );
}

function isHtmlButton(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLButtonElement {
  return element instanceof browserWindow.HTMLButtonElement;
}

function isInputButton(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLInputElement {
  return (
    element instanceof browserWindow.HTMLInputElement &&
    ["button", "reset", "submit"].includes(element.type.toLowerCase())
  );
}

function isTextControl(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLInputElement {
  return (
    element instanceof browserWindow.HTMLInputElement &&
    ["email", "password", "search", "tel", "text", "url"].includes(
      element.type.toLowerCase()
    )
  );
}

function isTextArea(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLTextAreaElement {
  return element instanceof browserWindow.HTMLTextAreaElement;
}

function isContentEditable(element: Element): element is HTMLElement {
  return (element as HTMLElement).isContentEditable;
}

function isEditableElement(
  element: Element,
  browserWindow: Window & typeof globalThis
): boolean {
  if (isContentEditable(element)) return true;
  if (isTextInput(element, browserWindow) || isTextArea(element, browserWindow))
    return !element.disabled && !element.readOnly;
  return false;
}

function isSpaceActivatable(
  element: Element,
  browserWindow: Window & typeof globalThis
): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof browserWindow.HTMLButtonElement) return true;
  if (!(element instanceof browserWindow.HTMLInputElement)) return false;
  return ["button", "checkbox", "radio", "reset", "submit"].includes(
    element.type.toLowerCase()
  );
}
