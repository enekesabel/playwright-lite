import {
  Evaluation,
  AdapterJSHandle,
  assertEvaluationOptions,
  assertMaxArguments,
} from "./evaluation";
import type { EvaluationFunction, EvaluationOptions } from "./evaluation";
import {
  injectedScriptFor,
  parseAriaExpectation,
  DEFAULT_TEST_ID_ATTRIBUTE,
} from "./injected";
import { AdapterTimeoutError } from "./errors";
import {
  validateDelay,
  validateNoWaitAfter,
  validateSignal,
  validateString,
} from "./protocolValidation";
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
type ActionDeadline = {
  timeout: number;
  expiresAt: number;
  signal?: AbortSignal;
};
type ActionTarget = { element: Element; point: ActionPoint };

export type SelectorQueryOptions = {
  signal?: AbortSignal;
  strict?: boolean;
  timeout?: number;
};

export type LocatorQueryOptions = Omit<SelectorQueryOptions, "strict">;

/** Visibility reads are one-shot: no `signal`, and `timeout` is ignored. */
export type SelectorVisibilityOptions = { strict?: boolean; timeout?: number };

export type LocatorVisibilityOptions = Omit<
  SelectorVisibilityOptions,
  "strict"
>;

type WaitForSelectorOptions = {
  signal?: AbortSignal;
  state?: "attached" | "detached" | "visible" | "hidden";
  strict?: boolean;
  timeout?: number;
};

type PageActionOptions = { signal?: AbortSignal; timeout?: number };
type PageActionWithNoWaitAfterOptions = PageActionOptions & {
  noWaitAfter?: boolean;
};
type PageStrictActionOptions = PageActionOptions & { strict?: boolean };
type PageStrictActionWithNoWaitAfterOptions = PageStrictActionOptions &
  PageActionWithNoWaitAfterOptions;
/** Shared by `press` and `type`, which take the same options. */
type PageKeyboardInputOptions = PageStrictActionWithNoWaitAfterOptions & {
  delay?: number;
};
type PageSetInputFilesOptions = PageActionWithNoWaitAfterOptions & {
  strict?: boolean;
};
export type PointerActionOptions = NonNullable<Parameters<Page["click"]>[1]>;
type HoverActionOptions = NonNullable<Parameters<Page["hover"]>[1]>;
type DoubleClickActionOptions = NonNullable<Parameters<Page["dblclick"]>[1]>;
type CheckedActionOptions = NonNullable<Parameters<Page["check"]>[1]>;

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
  retarget(
    element: Element,
    behavior: "follow-label" | "button-link"
  ): Element | null;
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
  setupHitTargetInterceptor(
    element: Element,
    action: "hover" | "mouse",
    point: ActionPoint,
    trial: boolean
  ): string | { stop(): "done" | { hitTargetDescription: string } };
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

export class PageImpl {
  readonly document: Document;
  readonly window: Window & typeof globalThis;
  readonly keyboard: BrowserKeyboard;
  readonly evaluation: Evaluation;
  readonly localStorage: PageWebStorage;
  readonly sessionStorage: PageWebStorage;
  private _injected: ReturnType<typeof injectedScriptFor> | undefined;
  private _injectedTestIdAttributeName: string | undefined;
  private pointerTarget: Element | undefined;
  private defaultTimeout: number | undefined;
  private defaultNavigationTimeout: number | undefined;

  constructor(
    browserWindow: Window & typeof globalThis,
    public testIdAttribute = DEFAULT_TEST_ID_ATTRIBUTE
  ) {
    this.window = browserWindow;
    this.document = browserWindow.document;
    this.keyboard = new BrowserKeyboard(this);
    this.evaluation = new Evaluation(this);
    this.localStorage = new PageWebStorage(this, "local");
    this.sessionStorage = new PageWebStorage(this, "session");
  }

  private get injected() {
    const testIdAttributeName = this.testIdAttribute;
    if (
      !this._injected ||
      this._injectedTestIdAttributeName !== testIdAttributeName
    ) {
      this._injected = injectedScriptFor(
        this.document.documentElement,
        testIdAttributeName
      );
      this._injectedTestIdAttributeName = testIdAttributeName;
    }
    return this._injected;
  }

  static fromWindow(
    browserWindow: Window & typeof globalThis = window,
    testIdAttribute = DEFAULT_TEST_ID_ATTRIBUTE
  ) {
    return new PageImpl(browserWindow, testIdAttribute);
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

  async addHighlight(selector: string, style?: string): Promise<void> {
    if (style !== undefined) style = validateString(style, "style");
    try {
      this.injected.addHighlight(this.injected.parseSelector(selector), style);
    } catch (error) {
      throw presentOriginalXPath(error, selector);
    }
  }

  async removeHighlight(selector: string): Promise<void> {
    try {
      this.injected.removeHighlight(this.injected.parseSelector(selector));
    } catch (error) {
      throw presentOriginalXPath(error, selector);
    }
  }

  async hideHighlight(): Promise<void> {
    this.injected.hideHighlight();
  }

  // ── Selector query operations ──────────────────────────────────

  async getAttribute(
    selector: string,
    name: string,
    options?: SelectorQueryOptions
  ): Promise<string | null> {
    return withAbortPrefix("page.getAttribute", () =>
      this.query(
        selector,
        `page.getAttribute(${JSON.stringify(selector)}, ${JSON.stringify(name)})`,
        options,
        false,
        (element) => element.getAttribute(name)
      )
    );
  }

  async textContent(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string | null> {
    return withAbortPrefix("page.textContent", () =>
      this.query(
        selector,
        `page.textContent(${JSON.stringify(selector)})`,
        options,
        false,
        (element) => element.textContent
      )
    );
  }

  async inputValue(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string> {
    return withAbortPrefix("page.inputValue", () =>
      this.query(
        selector,
        `page.inputValue(${JSON.stringify(selector)})`,
        options,
        false,
        (element) => this.inputValueForElement(element)
      )
    );
  }

  async isEnabled(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return withAbortPrefix("page.isEnabled", () =>
      this.queryState(selector, "enabled", options, false)
    );
  }

  async isDisabled(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return withAbortPrefix("page.isDisabled", () =>
      this.queryState(selector, "disabled", options, false)
    );
  }

  async isChecked(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return withAbortPrefix("page.isChecked", () =>
      this.queryState(selector, "checked", options, false)
    );
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
    return await withAbortPrefix("page.waitForSelector", () =>
      this.waitForSelectorInRoot(this.document, selector, options)
    );
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
   * Pinned 26a9e47 `Frame.expect` performs one check and then retries with
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
    selector: string | Element,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    options: PointerActionOptions = {}
  ): Promise<void> {
    options = assertPointerActionOptions("click", options);
    await this.performPointerAction(
      selector,
      label,
      "click",
      options,
      deadline
    );
  }

  async dblclickSelector(
    selector: string | Element,
    label: string,
    options: DoubleClickActionOptions = {},
    deadline = this.createActionDeadline(options.timeout)
  ): Promise<void> {
    options = assertPointerActionOptions("dblclick", options);
    await this.performPointerAction(
      selector,
      label,
      "dblclick",
      options,
      deadline
    );
  }

  /** Pinned dom.ts owns the ordering: actionability, scroll, hit interception,
   * temporary modifiers, input, interception cleanup. Only input is synthetic.
   */
  private async performPointerAction(
    selector: string | Element,
    label: string,
    action: "click" | "dblclick" | "hover",
    options: PointerActionOptions,
    deadline: ActionDeadline,
    checked?: boolean,
    apiMethod:
      | "click"
      | "dblclick"
      | "hover"
      | "check"
      | "uncheck"
      | "setChecked" = action
  ): Promise<void> {
    try {
      this.attachActionSignal(deadline, options.signal);
      while (true) {
        this.assertActionDeadline(deadline, action);
        try {
          if (checked !== undefined) {
            const candidate = this.resolvePointerElement(
              selector,
              label,
              options.strict ?? true
            );
            if (this.hasCheckedState(candidate, checked)) return;
          }
          const target = await this.retryActionability(
            selector,
            label,
            action,
            action === "hover"
              ? ["visible", "stable"]
              : ["visible", "enabled", "stable"],
            true,
            deadline,
            options.position,
            options
          );
          // A Locator may have resolved a replacement while waiting. Never
          // toggle it when its checked state already satisfies the request.
          if (
            checked !== undefined &&
            this.hasCheckedState(target.element, checked)
          )
            return;
          let interceptor:
            { stop(): "done" | { hitTargetDescription: string } } | undefined;
          if (!options.force) {
            const result = this.actionableInjected.setupHitTargetInterceptor(
              target.element,
              action === "hover" ? "hover" : "mouse",
              target.point,
              !!options.trial
            );
            if (typeof result === "string")
              throw new Error(
                result === "error:notconnected"
                  ? "Element is not connected"
                  : `Element does not receive pointer events: ${result}`
              );
            interceptor = result;
          }
          const previousModifiers = this.keyboard.modifierState();
          let interception: "done" | { hitTargetDescription: string } = "done";
          try {
            if (options.modifiers)
              await this.keyboard.ensureModifiers(options.modifiers, deadline);
            this.assertActionDeadline(deadline, action);
            await this.movePointer(target.point, deadline, action);
            if (!options.trial && action !== "hover")
              await this.dispatchClick(
                target.element,
                target.point,
                action === "dblclick" ? 2 : (options.clickCount ?? 1),
                options,
                deadline,
                action
              );
          } finally {
            interception = interceptor?.stop() ?? "done";
            // Cleanup is not input activation and must also run after timeout.
            if (options.modifiers)
              await this.keyboard.ensureModifiers(previousModifiers);
          }
          if (interception !== "done")
            throw new Error(
              `Element does not receive pointer events: ${interception.hitTargetDescription}`
            );
          if (
            !options.trial &&
            checked !== undefined &&
            !this.hasCheckedState(target.element, checked)
          )
            throw new Error("Clicking the checkbox did not change its state");
          return;
        } catch (error) {
          if (typeof selector !== "string" && !selector.isConnected)
            throw new Error("Element is not attached to the DOM", {
              cause: error,
            });
          // The preflight loop handles state/geometry. Only retry a target
          // replacement or interception discovered between preflight and input.
          const message = asError(error).message;
          if (!(
            message === "Element is not connected" ||
            message.startsWith("Element does not receive pointer events") ||
            message.startsWith("No elements found for locator")
          ))
            throw error;
          await this.waitWithinActionDeadline(
            ACTION_RETRY_DELAY,
            deadline,
            action
          );
        }
      }
    } catch (error) {
      const result = asError(error);
      const method = label.match(
        /^(page|elementHandle)\.(click|dblclick|hover|check|uncheck|setChecked)(?:\(|$)/
      );
      const prefix = method
        ? `${method[1]}.${method[2]}`
        : `locator.${apiMethod}`;
      result.message = `${prefix}: ${result.message.replace(new RegExp(`^${action}: `), "")}`;
      throw result;
    }
  }

  private resolvePointerElement(
    subject: string | Element,
    label: string,
    strict: boolean
  ): Element {
    if (typeof subject === "string")
      return this.queryElement(subject, label, strict);
    if (!subject.isConnected)
      throw new Error("Element is not attached to the DOM");
    return subject;
  }

  private hasCheckedState(element: Element, checked: boolean): boolean {
    const state = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).elementState(element, "checked");
    if (state.received === "error:notconnected")
      throw new Error("Element is not connected");
    if (state.matches === checked) return true;
    if (!checked && "isRadio" in state && state.isRadio)
      throw new Error(
        "Cannot uncheck radio button. Radio buttons can only be unchecked by selecting another radio button in the same group."
      );
    return state.matches === checked;
  }

  async fillSelector(
    selector: string,
    value: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal
  ) {
    this.attachActionSignal(deadline, signal);
    const { element } = await this.retryActionability(
      selector,
      label,
      "fill",
      ["visible", "enabled", "editable"],
      false,
      deadline,
      undefined,
      undefined,
      strict
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
    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal,
    delay?: number
  ) {
    this.attachActionSignal(deadline, signal);
    const element = await this.query(
      selector,
      label,
      { signal, timeout },
      strict,
      (candidate) => candidate,
      deadline
    );
    this.assertActionDeadline(deadline, "press");
    this.focusElement(element);
    await this.keyboard.press(key, { delay }, deadline);
  }

  async focusSelector(
    selector: string,
    label: string,
    options?: LocatorQueryOptions,
    strict = true
  ): Promise<void> {
    await this.query(selector, label, options, strict, (element) => {
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
    selector: string | Element,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    options: HoverActionOptions = {}
  ): Promise<void> {
    options = assertPointerActionOptions("hover", options);
    await this.performPointerAction(
      selector,
      label,
      "hover",
      options,
      deadline
    );
  }

  async setCheckedSelector(
    selector: string | Element,
    checked: boolean,
    label: string,
    options: CheckedActionOptions = {},
    deadline = this.createActionDeadline(options.timeout),
    apiMethod: "check" | "uncheck" | "setChecked" = "setChecked"
  ): Promise<void> {
    options = assertPointerActionOptions("setChecked", options);
    if (typeof checked !== "boolean")
      throw new TypeError("checked must be a boolean");
    await this.performPointerAction(
      selector,
      label,
      "click",
      options,
      deadline,
      checked,
      apiMethod
    );
  }

  async selectOptionSelector(
    selector: string,
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal
  ): Promise<string[]> {
    this.attachActionSignal(deadline, signal);
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
        deadline,
        undefined,
        undefined,
        strict
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
      try {
        await this.waitWithinActionDeadline(
          Math.min(ACTION_RETRY_DELAY, remaining),
          deadline,
          "select option"
        );
      } catch (error) {
        if (error instanceof AdapterTimeoutError)
          throw new AdapterTimeoutError(
            `select option: Timeout ${deadline.timeout}ms exceeded. ${lastError.message}`,
            { cause: lastError }
          );
        throw error;
      }
    }
  }

  async selectText(
    selector: string,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    signal?: AbortSignal
  ): Promise<void> {
    this.attachActionSignal(deadline, signal);
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
    deadline = this.createActionDeadline(timeout),
    signal?: AbortSignal
  ): Promise<void> {
    this.attachActionSignal(deadline, signal);
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
      signal?: AbortSignal;
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
        signal: options.signal,
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
    options: PageSetInputFilesOptions = {},
    strict = false
  ): Promise<void> {
    assertPageActionOptions("setInputFiles", options, [
      "noWaitAfter",
      "strict",
    ]);
    if (options.strict !== undefined && typeof options.strict !== "boolean")
      throw new TypeError("setInputFiles strict must be a boolean");
    const payloads = inputFilePayloads(files);
    const deadline = this.createActionDeadline(options.timeout);
    this.attachActionSignal(deadline, options.signal);
    await this.query(
      selector,
      selector,
      { signal: options.signal, timeout: options.timeout },
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
   * Mirrors pinned 26a9e47 `server/frames.ts` Frame._content: serialize the
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
    return withAbortPrefix("page.innerText", () =>
      this.query(
        selector,
        `page.innerText(${JSON.stringify(selector)})`,
        options,
        false,
        (element) => {
          if (element.namespaceURI !== "http://www.w3.org/1999/xhtml")
            throw new Error("Node is not an HTMLElement");
          return (element as HTMLElement).innerText;
        }
      )
    );
  }

  async innerHTML(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<string> {
    return withAbortPrefix("page.innerHTML", () =>
      this.query(
        selector,
        `page.innerHTML(${JSON.stringify(selector)})`,
        options,
        false,
        (element) => element.innerHTML
      )
    );
  }

  async isEditable(
    selector: string,
    options?: SelectorQueryOptions
  ): Promise<boolean> {
    return withAbortPrefix("page.isEditable", () =>
      this.queryState(selector, "editable", options, false)
    );
  }

  async isVisible(
    selector: string,
    options?: SelectorVisibilityOptions
  ): Promise<boolean> {
    return this.selectorIsVisible("isVisible", selector, options);
  }

  async isHidden(
    selector: string,
    options?: SelectorVisibilityOptions
  ): Promise<boolean> {
    return !this.selectorIsVisible("isHidden", selector, options);
  }

  private selectorIsVisible(
    method: string,
    selector: string,
    options: SelectorVisibilityOptions | undefined
  ): boolean {
    assertQueryOptions(options, ["strict", "timeout"]);
    if (options?.strict !== undefined && typeof options.strict !== "boolean")
      throw new TypeError(`${method} strict must be a boolean`);

    const element = options?.strict
      ? this.resolveLocatorElement(selector, true)
      : this.resolveAll(selector)[0];
    if (!element) return false;
    return this.elementState(element, "visible").matches;
  }

  async click(selector: string, options?: PointerActionOptions): Promise<void> {
    assertPointerActionOptions("click", options);
    await this.clickSelector(
      selector,
      `page.click(${JSON.stringify(selector)})`,
      options?.timeout,
      undefined,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async fill(
    selector: string,
    value: string,
    options?: PageStrictActionWithNoWaitAfterOptions
  ): Promise<void> {
    assertPageActionOptions("fill", options, ["noWaitAfter", "strict"]);
    await withAbortPrefix("page.fill", () =>
      this.fillSelector(
        selector,
        value,
        `page.fill(${JSON.stringify(selector)})`,
        options?.timeout,
        undefined,
        options?.strict === true,
        options?.signal
      )
    );
  }

  async setInputFiles(
    selector: string,
    files: InputFiles,
    options?: PageSetInputFilesOptions
  ): Promise<void> {
    await withAbortPrefix("page.setInputFiles", () =>
      this.setInputFilesSelector(selector, files, options)
    );
  }

  async press(
    selector: string,
    key: string,
    options?: PageKeyboardInputOptions
  ): Promise<void> {
    const delay = assertPageActionOptions("press", options, [
      "delay",
      "noWaitAfter",
      "strict",
    ]);
    await withAbortPrefix("page.press", () =>
      this.pressSelector(
        selector,
        key,
        `page.press(${JSON.stringify(selector)})`,
        options?.timeout,
        undefined,
        options?.strict === true,
        options?.signal,
        delay
      )
    );
  }

  async type(
    selector: string,
    text: string,
    options?: PageKeyboardInputOptions
  ): Promise<void> {
    await withAbortPrefix("page.type", () =>
      this.typeSelector(
        selector,
        text,
        options,
        `page.type(${JSON.stringify(selector)})`,
        options?.strict === true
      )
    );
  }

  async typeSelector(
    selector: string,
    text: string,
    options: PageKeyboardInputOptions | undefined,
    label: string,
    strict: boolean
  ): Promise<void> {
    const delay = assertPageActionOptions("type", options, [
      "delay",
      "noWaitAfter",
      "strict",
    ]);
    const deadline = this.createActionDeadline(options?.timeout);
    this.attachActionSignal(deadline, options?.signal);
    await this.query(
      selector,
      label,
      { signal: options?.signal, timeout: options?.timeout },
      strict,
      (element) => {
        const result = this.actionableInjected.focusNode(element, true);
        if (result === "error:notconnected")
          throw new Error("Element is not connected");
      },
      deadline
    );
    await this.keyboard.type(text, { delay }, deadline);
  }

  async focus(
    selector: string,
    options?: PageStrictActionOptions
  ): Promise<void> {
    assertPageActionOptions("focus", options, ["strict"]);
    await withAbortPrefix("page.focus", () =>
      this.focusSelector(
        selector,
        `page.focus(${JSON.stringify(selector)})`,
        { signal: options?.signal, timeout: options?.timeout },
        options?.strict === true
      )
    );
  }

  async hover(selector: string, options?: HoverActionOptions): Promise<void> {
    await this.hoverSelector(
      selector,
      `page.hover(${JSON.stringify(selector)})`,
      options?.timeout,
      undefined,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async selectOption(
    selector: string,
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    options?: PageStrictActionWithNoWaitAfterOptions
  ): Promise<string[]> {
    assertPageActionOptions("selectOption", options, ["noWaitAfter", "strict"]);
    return withAbortPrefix("page.selectOption", () =>
      this.selectOptionSelector(
        selector,
        values,
        `page.selectOption(${JSON.stringify(selector)})`,
        options?.timeout,
        undefined,
        options?.strict === true,
        options?.signal
      )
    );
  }

  async check(selector: string, options?: CheckedActionOptions): Promise<void> {
    await this.setCheckedSelector(
      selector,
      true,
      `page.check(${JSON.stringify(selector)})`,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async uncheck(
    selector: string,
    options?: CheckedActionOptions
  ): Promise<void> {
    await this.setCheckedSelector(
      selector,
      false,
      `page.uncheck(${JSON.stringify(selector)})`,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async setChecked(
    selector: string,
    checked: boolean,
    options?: CheckedActionOptions
  ): Promise<void> {
    await this.setCheckedSelector(
      selector,
      checked,
      `page.setChecked(${JSON.stringify(selector)})`,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async dblclick(
    selector: string,
    options?: DoubleClickActionOptions
  ): Promise<void> {
    await this.dblclickSelector(
      selector,
      `page.dblclick(${JSON.stringify(selector)})`,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async dispatchEvent(
    selector: string,
    type: string,
    eventInit: object = {},
    options?: PageDispatchEventOptions
  ): Promise<void> {
    assertPageDispatchEventOptions(options);
    await withAbortPrefix("page.dispatchEvent", () =>
      this.dispatchEventSelector(
        selector,
        type,
        eventInit,
        `page.dispatchEvent(${JSON.stringify(selector)})`,
        options?.timeout,
        undefined,
        options?.strict === true,
        options?.signal
      )
    );
  }

  async dispatchEventSelector(
    selector: string,
    type: string,
    eventInit: object,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    strict = true,
    signal?: AbortSignal
  ): Promise<void> {
    this.attachActionSignal(deadline, signal);
    await this.query(
      selector,
      label,
      { signal, timeout },
      strict,
      (element) =>
        this.actionableInjected.dispatchEvent(element, type, eventInit),
      deadline
    );
  }

  /**
   * Pinned 26a9e47 client/frame.ts and server/frames.ts default to load,
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
   * Pinned 26a9e47 `Page.ariaSnapshot` delegates to the main frame. The
   * single-document adapter has that frame in-process, so it delegates
   * directly to the compiled InjectedScript which owns ARIA-tree generation
   * and rendering. There is no frame traversal or protocol transport here.
   */
  async ariaSnapshot(options: AriaSnapshotOptions = {}): Promise<string> {
    return withAbortPrefix("page.ariaSnapshot", async () => {
      assertAriaSnapshotOptions(options);
      if (options.signal?.aborted) throw actionAborted(options.signal, false);
      // Protocol evaluation naturally waits for a parser-blocking resource to
      // yield. An in-process adapter call does not cross that task boundary.
      await this.waitForDocumentParser(options);

      // Pinned `ariaSnapshotForFrame` resolves `body,frameset`, rather than
      // documentElement, so the document wrapper itself is not rendered.
      return this.injectedAriaSnapshot(
        this.document.body ?? this.document.documentElement,
        options
      );
    });
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
      const aborted = () => settle(actionAborted(options.signal!, true));

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

  /** Evaluates through the pinned Playwright UtilityScript. */
  async evaluate<R>(
    pageFunction: EvaluationFunction<R>,
    arg?: unknown,
    options?: EvaluationOptions
  ): Promise<R> {
    assertMaxArguments(arguments.length, 3);
    assertEvaluationOptions(options);
    return this._evaluateExpression(
      pageFunction,
      typeof pageFunction === "function",
      arg
    );
  }

  /** Evaluates through the pinned Playwright UtilityScript. */
  async $eval<T>(
    selector: string,
    callback: EvaluationFunction<T>,
    arg?: unknown
  ): Promise<T> {
    assertMaxArguments(arguments.length, 3);
    const element = this.queryElement(
      selector,
      `page.$eval(${JSON.stringify(selector)})`,
      false
    );
    return this.evaluation.byValue(
      callback,
      typeof callback === "function",
      arg,
      element
    );
  }

  /** Evaluates through the pinned Playwright UtilityScript. */
  async $$eval<T>(
    selector: string,
    callback: EvaluationFunction<T>,
    arg?: unknown
  ): Promise<T> {
    assertMaxArguments(arguments.length, 3);
    return this.evaluation.byValue(
      callback,
      typeof callback === "function",
      arg,
      this.resolveAll(selector)
    );
  }

  url(): string {
    return this.window.location.href;
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await this.wait(timeout);
  }

  /** Evaluates through the pinned Playwright UtilityScript. */
  async _evaluateExpression<R>(
    expression: EvaluationFunction<R>,
    isFunction: boolean,
    arg?: unknown
  ): Promise<R> {
    return this.evaluation.byValue(expression, isFunction, arg);
  }

  /**
   * Polls a predicate in the controlled document until it returns a
   * truthy value.
   *
   * Mirrors pinned 26a9e47 server/frames.ts:1626-1694:
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
   * Mirrors pinned 26a9e47 server/frames.ts:1626-1694:
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
    const predicate = this.evaluation.predicate(pageFunction, isFunction, arg);
    const polling = options?.polling ?? "raf";

    // Validate polling per frames.ts:1628
    if (typeof polling === "string" && polling !== "raf")
      throw new Error("Unknown polling option: " + polling);
    if (typeof polling === "number" && polling <= 0)
      throw new Error("Cannot poll with non-positive interval: " + polling);

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
                  resolve(new AdapterJSHandle(v, this.evaluation));
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
            resolve(new AdapterJSHandle(result, this.evaluation));
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
    return this.locator(getByTestIdSelector(this.testIdAttribute, testId));
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

  private attachActionSignal(
    deadline: ActionDeadline,
    signal: AbortSignal | undefined
  ) {
    deadline.signal = signal;
    if (signal?.aborted) throw actionAborted(signal, false);
  }

  private assertActionDeadline(
    deadline: ActionDeadline | undefined,
    actionName: string
  ) {
    if (deadline?.signal?.aborted) throw actionAborted(deadline.signal, true);
    if (deadline && Date.now() >= deadline.expiresAt)
      throw new AdapterTimeoutError(
        `${actionName}: Timeout ${deadline.timeout}ms exceeded.`
      );
  }

  checkKeyboardActionDeadline(deadline: ActionDeadline | undefined) {
    this.assertActionDeadline(deadline, "press");
  }

  // Pinned Keyboard.press/type delay through progress.wait, which races the
  // timer against the abort. The pointer path already waits that way here.
  async waitKeyboardDelay(
    durationMs: number | undefined,
    deadline: ActionDeadline | undefined
  ) {
    await this.waitWithinActionDeadline(durationMs, deadline, "press");
  }

  private async waitWithinActionDeadline(
    durationMs: number | undefined,
    deadline: ActionDeadline | undefined,
    actionName: string
  ) {
    this.assertActionDeadline(deadline, actionName);
    if (!durationMs || durationMs <= 0) return;
    const remaining = deadline ? deadline.expiresAt - Date.now() : durationMs;
    const completed = await waitForExpectationRetry(
      this.window,
      Math.min(durationMs, remaining),
      deadline?.signal
    );
    if (!completed && deadline?.signal)
      throw actionAborted(deadline.signal, true);
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
    options?: LocatorVisibilityOptions
  ): boolean {
    assertQueryOptions(options, ["timeout"]);

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
    if (options.signal?.aborted) throw actionAborted(options.signal, false);

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
    pageFunction: EvaluationFunction<T>,
    arg?: unknown,
    options?: LocatorQueryOptions & EvaluationOptions
  ): Promise<T> {
    assertEvaluationOptions(options);
    const { exposeFunctions: _exposeFunctions, ...queryOptions } =
      options ?? {};
    void _exposeFunctions;
    const element = await this.query(
      selector,
      label,
      queryOptions,
      true,
      (element) => element
    );
    // Do not retry callback exceptions as selector resolution errors.
    return this.evaluation.byValue(
      pageFunction,
      typeof pageFunction === "function",
      arg,
      element
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
      throw new Error("Element is not attached to the DOM");
    return result.matches;
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
    const signal = options.signal;
    if (signal?.aborted) throw actionAborted(signal, false);

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
      const delay = Math.min(QUERY_RETRY_DELAY, deadline - Date.now());
      if (!(await waitForExpectationRetry(this.window, delay, signal)))
        throw actionAborted(signal!, true);
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
    assertQueryOptions(
      options,
      strict ? ["signal", "timeout"] : ["signal", "strict", "timeout"]
    );
    const timeout =
      actionDeadline?.timeout ??
      this.resolveTimeout(options?.timeout, DEFAULT_QUERY_TIMEOUT);
    const signal = options?.signal;
    if (signal?.aborted) throw actionAborted(signal, false);
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
          throw actionAborted(signal!, true);
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
    if (deadline?.signal?.aborted) throw actionAborted(deadline.signal, true);
    // An expired deadline is the caller's timeout, described by the caller.
    if (deadline && Date.now() >= deadline.expiresAt) throw timeoutError();
    if (!deadline) return operation;

    let timeoutHandle: number | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        // Pinned stability checks wait for requestAnimationFrame. They only
        // inspect an element, so ending our await cannot cause a late input
        // action; the pinned primitive exposes no cancellation handle.
        if (deadline.expiresAt !== Infinity)
          timeoutHandle = this.window.setTimeout(
            () => reject(timeoutError()),
            Math.max(0, deadline.expiresAt - Date.now())
          );
        if (deadline.signal) {
          onAbort = () => reject(actionAborted(deadline.signal!, true));
          deadline.signal.addEventListener("abort", onAbort, { once: true });
        }
        operation.then(resolve, reject);
      });
    } finally {
      if (timeoutHandle !== undefined) this.window.clearTimeout(timeoutHandle);
      if (onAbort) deadline.signal?.removeEventListener("abort", onAbort);
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
    selector: string | Element,
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
    position?: ActionPoint,
    pointerOptions?: PointerActionOptions,
    strict = pointerOptions?.strict ?? true
  ): Promise<ActionTarget> {
    let lastError: Error | undefined;
    let retry = 0;
    const log: string[] = [];
    const timeoutError = () =>
      new AdapterTimeoutError(
        `${actionName}: Timeout ${deadline.timeout}ms exceeded.${lastError ? ` ${lastError.message}` : ""}` +
          (pointerOptions
            ? `\nCall log:\n  - attempting ${actionName} action${pointerOptions.trial ? " (trial run)" : ""}\n${log.join("\n")}`
            : ""),
        { cause: lastError }
      );
    const throwTimeout = () => {
      if (lastError) throw timeoutError();
      this.assertActionDeadline(deadline, actionName);
    };

    while (true) {
      if (Date.now() >= deadline.expiresAt) throwTimeout();
      try {
        const element = this.resolvePointerElement(selector, label, strict);
        if (pointerOptions && !pointerOptions.force)
          log.push(
            `  - waiting for element to be ${states.includes("enabled") ? "visible, enabled and stable" : "visible and stable"}`
          );
        if (!pointerOptions?.force)
          await this.ensureActionable(element, states, deadline);
        if (Date.now() >= deadline.expiresAt) throwTimeout();
        if (
          actionName !== "scroll into view" &&
          pointerOptions?.scroll !== "none"
        ) {
          if (!pointerOptions || position)
            this.scrollIntoView(element, position);
          else if (retry % 4 === 0) this.scrollIntoViewIfNeeded(element);
          else
            element.scrollIntoView({
              block: (["end", "center", "start"] as const)[(retry - 1) % 4],
              inline: (["end", "center", "start"] as const)[(retry - 1) % 4],
              behavior: "instant",
            });
        }
        // Scrolling can change visibility or expose a covering element.
        if (!pointerOptions?.force)
          await this.ensureActionable(element, states, deadline);
        const point = checkHitTarget
          ? this.ensureReceivesEvents(
              element,
              position,
              !!pointerOptions?.force
            )
          : actionPoint(element, position, this.window);
        if (Date.now() >= deadline.expiresAt) throwTimeout();
        return { element, point };
      } catch (error) {
        if (typeof selector !== "string" && !selector.isConnected)
          throw new Error("Element is not attached to the DOM", {
            cause: error,
          });
        if (
          !isRetryableActionError(error) ||
          (pointerOptions?.force &&
            !asError(error).message.startsWith("No elements found for locator"))
        )
          throw error;
        lastError = asError(error);
        const remaining = deadline.expiresAt - Date.now();
        const delay = pointerOptions
          ? [0, 20, 100, 100, 500][Math.min(retry++, 4)]
          : ACTION_RETRY_DELAY;
        if (pointerOptions) {
          const reason = lastError.message
            .replace(/^Element/, "element")
            .replace(
              /^element does not receive pointer events: (.*)$/,
              "$1 intercepts pointer events"
            );
          log.push(`  - ${reason}`);
          if (remaining > 0)
            log.push(
              `  - retrying ${actionName} action`,
              `  - waiting ${delay}ms`
            );
          if (log.length > 60) log.splice(0, log.length - 60);
        }
        if (remaining <= 0) throw timeoutError();
        try {
          await this.waitWithinActionDeadline(
            Math.min(delay, remaining),
            deadline,
            actionName
          );
        } catch (error) {
          if (error instanceof AdapterTimeoutError) throw timeoutError();
          throw error;
        }
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
    const isContents =
      this.window.getComputedStyle(element).display === "contents";
    if (!position && !isContents) return;
    const requestedPoint = () => {
      if (position) return actionPoint(element, position, this.window);
      // display:contents has no element box. Scroll its real text/child
      // fragment geometry; never dispatch directly to an offscreen element.
      const range = this.document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    // Pinned ElementHandle._performPointerAction scrolls the requested point,
    // not the whole element. DOM scrollIntoView has no rectangle parameter;
    // adjust each containing scrollport, then the viewport, from inside out.
    for (let node = element.parentNode; node; node = node.parentNode) {
      if (node instanceof ShadowRoot) node = node.host;
      if (!(node instanceof Element) || node === this.document.scrollingElement)
        continue;
      const point = requestedPoint();
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
    const point = requestedPoint();
    const viewport =
      this.document.compatMode === "BackCompat"
        ? this.document.body
        : this.document.documentElement;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    this.window.scrollBy({
      left: point.x < 0 || point.x >= width ? point.x - width / 2 : 0,
      top: point.y < 0 || point.y >= height ? point.y - height / 2 : 0,
      behavior: "instant",
    });
  }

  private scrollIntoViewIfNeeded(element: Element) {
    if (this.window.getComputedStyle(element).display === "contents") {
      this.scrollIntoView(element);
      return;
    }
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
    position?: ActionPoint,
    force = false
  ): ActionPoint {
    const point = this.pointerPoint(element, position);
    if (force) return point;
    // Same retargeting as dom.ts setupHitTargetInterceptor, not a custom
    // ancestor heuristic: nested labels/buttons/links retain pinned semantics.
    const target = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).retarget(element, "button-link");
    if (!target) throw new Error("Element is not connected");
    const result = this.actionableInjected.expectHitTarget(point, target);
    if (result !== "done")
      throw new Error(
        `Element does not receive pointer events: ${result.hitTargetDescription}`
      );
    return point;
  }

  private pointerPoint(element: Element, position?: ActionPoint): ActionPoint {
    if (!element.isConnected) throw new Error("Element is not connected");
    let rects = Array.from(element.getClientRects());
    if (
      !rects.length &&
      this.window.getComputedStyle(element).display === "contents"
    ) {
      const range = this.document.createRange();
      range.selectNodeContents(element);
      rects = Array.from(range.getClientRects());
    }
    if (!rects.length) throw new Error("Element is not visible");
    const viewport =
      this.document.compatMode === "BackCompat"
        ? this.document.body
        : this.document.documentElement;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (position) {
      const point = actionPoint(element, position, this.window);
      if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height)
        throw new Error("Element is outside of the viewport");
      return point;
    }
    // Pinned dom.ts clips content quads and uses the first nonempty one.
    // ponytail: DOM client rectangles cover inline fragments, not protocol
    // quadrilaterals for arbitrary 3D transforms; those remain diagnostic.
    for (const rect of rects) {
      const left = Math.max(0, rect.left),
        right = Math.min(width, rect.right);
      const top = Math.max(0, rect.top),
        bottom = Math.min(height, rect.bottom);
      if (
        right > left &&
        bottom > top &&
        (right - left) * (bottom - top) > 0.99
      )
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
    throw new Error("Element is outside of the viewport");
  }

  private async pointerTask<T>(
    deadline: ActionDeadline,
    action: string,
    task: () => T
  ): Promise<T> {
    // Like pinned WebViewInput._postTask, each event is a browser task. Check
    // the shared deadline inside the task, so expiration cannot activate later.
    return new Promise<T>((resolve, reject) =>
      this.window.setTimeout(() => {
        try {
          this.assertActionDeadline(deadline, action);
          resolve(task());
        } catch (error) {
          reject(error);
        }
      })
    );
  }

  private async movePointer(
    point: ActionPoint,
    deadline: ActionDeadline,
    action: string
  ) {
    const target = this.eventTargetAtPoint(point);
    const previous = this.pointerTarget;
    if (previous !== target && previous?.isConnected) {
      await this.pointerTask(deadline, action, () =>
        this.dispatchPointerEvent(
          previous,
          "pointerout",
          point,
          -1,
          0,
          0,
          true,
          target
        )
      );
      await this.pointerTask(deadline, action, () =>
        this.dispatchPointerEvent(
          previous,
          "pointerleave",
          point,
          -1,
          0,
          0,
          false,
          target
        )
      );
      await this.pointerTask(deadline, action, () =>
        this.dispatchMouseEvent(
          previous,
          "mouseout",
          point,
          0,
          0,
          0,
          true,
          target
        )
      );
      await this.pointerTask(deadline, action, () =>
        this.dispatchMouseEvent(
          previous,
          "mouseleave",
          point,
          0,
          0,
          0,
          false,
          target
        )
      );
    }
    this.pointerTarget = target;
    if (previous !== target) {
      await this.pointerTask(deadline, action, () =>
        this.dispatchPointerEvent(
          target,
          "pointerover",
          point,
          -1,
          0,
          0,
          true,
          previous
        )
      );
      await this.pointerTask(deadline, action, () =>
        this.dispatchPointerEvent(
          target,
          "pointerenter",
          point,
          -1,
          0,
          0,
          false,
          previous
        )
      );
      await this.pointerTask(deadline, action, () =>
        this.dispatchMouseEvent(
          target,
          "mouseover",
          point,
          0,
          0,
          0,
          true,
          previous
        )
      );
      await this.pointerTask(deadline, action, () =>
        this.dispatchMouseEvent(
          target,
          "mouseenter",
          point,
          0,
          0,
          0,
          false,
          previous
        )
      );
    }
    await this.pointerTask(deadline, action, () =>
      this.dispatchPointerEvent(
        this.eventTargetAtPoint(point),
        "pointermove",
        point,
        -1,
        0,
        0
      )
    );
    await this.pointerTask(deadline, action, () =>
      this.dispatchMouseEvent(
        this.eventTargetAtPoint(point),
        "mousemove",
        point,
        0,
        0,
        0
      )
    );
  }

  private async dispatchClick(
    element: Element,
    point: ActionPoint,
    clickCount: number,
    options: PointerActionOptions,
    deadline: ActionDeadline,
    action: string
  ) {
    const button =
      options.button === "right" ? 2 : options.button === "middle" ? 1 : 0;
    const buttons = button === 0 ? 1 : button === 1 ? 4 : 2;
    for (let detail = 1; detail <= clickCount; detail++) {
      if (!element.isConnected) throw new Error("Element is not connected");
      const downTarget = this.eventTargetAtPoint(point);
      const pointerDownAllowed = await this.pointerTask(deadline, action, () =>
        this.dispatchPointerEvent(
          this.eventTargetAtPoint(point),
          "pointerdown",
          point,
          button,
          buttons,
          0
        )
      );
      if (pointerDownAllowed) {
        await this.pointerTask(deadline, action, () => {
          const target = this.eventTargetAtPoint(point);
          const allowed = this.dispatchMouseEvent(
            target,
            "mousedown",
            point,
            button,
            buttons,
            detail
          );
          this.assertActionDeadline(deadline, action);
          if (allowed) this.focusPointerTarget(target);
        });
      }
      if (button === 2)
        await this.pointerTask(deadline, action, () =>
          this.dispatchMouseEvent(
            this.eventTargetAtPoint(point),
            "contextmenu",
            point,
            button,
            buttons,
            detail
          )
        );
      await this.waitWithinActionDeadline(options.delay, deadline, action);
      await this.pointerTask(deadline, action, () =>
        this.dispatchPointerEvent(
          this.eventTargetAtPoint(point),
          "pointerup",
          point,
          button,
          0,
          0
        )
      );
      if (pointerDownAllowed)
        await this.pointerTask(deadline, action, () =>
          this.dispatchMouseEvent(
            this.eventTargetAtPoint(point),
            "mouseup",
            point,
            button,
            0,
            detail
          )
        );
      await this.pointerTask(deadline, action, () => {
        const upTarget = this.eventTargetAtPoint(point);
        let target: Element | null = downTarget;
        while (target && !target.contains(upTarget))
          target = target.parentElement;
        if (target?.isConnected)
          this.dispatchMouseEvent(
            target,
            button === 0 ? "click" : "auxclick",
            point,
            button,
            0,
            detail
          );
      });
      if (detail === 2 && button === 0)
        await this.pointerTask(deadline, action, () =>
          this.dispatchMouseEvent(
            this.eventTargetAtPoint(point),
            "dblclick",
            point,
            button,
            0,
            detail
          )
        );
      if (detail < clickCount)
        await this.waitWithinActionDeadline(options.delay, deadline, action);
    }
  }

  private eventTargetAtPoint(point: ActionPoint): Element {
    let target =
      this.document.elementFromPoint(point.x, point.y) ??
      this.document.documentElement;
    while (target.shadowRoot?.mode === "open") {
      const inner = target.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === target) break;
      target = inner;
    }
    return target;
  }

  private focusPointerTarget(element: Element) {
    const target = (
      this.injected as typeof this.injected & QueryCapableInjectedScript
    ).retarget(element, "follow-label");
    // Real mouse focus does not scroll a different part of a large control
    // into view. InjectedScript.focusNode is the keyboard focus operation.
    if (target && typeof (target as HTMLElement).focus === "function")
      (target as HTMLElement).focus({ preventScroll: true });
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
    deadline: ActionDeadline,
    strict = true
  ) {
    const element = await this.query(
      selector,
      label,
      { timeout: deadline.timeout },
      strict,
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
    bubbles = true,
    relatedTarget?: Element
  ): boolean {
    const event = new this.window.PointerEvent(type, {
      ...this.pointerEventInit(
        point,
        button,
        buttons,
        detail,
        bubbles,
        relatedTarget
      ),
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      pressure: buttons ? 0.5 : 0,
    });
    Object.defineProperty(event, "__pwTrustedSynthetic", { value: true });
    return element.dispatchEvent(event);
  }

  private dispatchMouseEvent(
    element: Element,
    type: string,
    point: ActionPoint,
    button: number,
    buttons: number,
    detail: number,
    bubbles = true,
    relatedTarget?: Element
  ): boolean {
    const init = this.pointerEventInit(
      point,
      button,
      buttons,
      detail,
      bubbles,
      relatedTarget
    );
    const event =
      type === "click" || type === "auxclick"
        ? new this.window.PointerEvent(type, {
            ...init,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          })
        : new this.window.MouseEvent(type, init);
    Object.defineProperty(event, "__pwTrustedSynthetic", { value: true });
    return element.dispatchEvent(event);
  }

  private pointerEventInit(
    point: ActionPoint,
    button: number,
    buttons: number,
    detail: number,
    bubbles: boolean,
    relatedTarget?: Element
  ): MouseEventInit {
    const modifiers = this.keyboard.modifierState();
    return {
      bubbles,
      button,
      buttons,
      cancelable: true,
      composed: bubbles,
      clientX: point.x,
      clientY: point.y,
      detail,
      view: this.window,
      relatedTarget: relatedTarget ?? null,
      altKey: modifiers.includes("Alt"),
      ctrlKey: modifiers.includes("Control"),
      metaKey: modifiers.includes("Meta"),
      shiftKey: modifiers.includes("Shift"),
    };
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

type WebStorage = Page["localStorage"];

class PageWebStorage implements WebStorage {
  constructor(
    private readonly page: PageImpl,
    private readonly kind: "local" | "session"
  ) {}

  async items(): Promise<{ name: string; value: string }[]> {
    const storage = this.storage();
    const items: { name: string; value: string }[] = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (name !== null)
        items.push({ name, value: storage.getItem(name) ?? "" });
    }
    return items;
  }

  async getItem(name: string): Promise<string | null> {
    name = validateString(name, "name");
    return this.storage().getItem(name);
  }

  async setItem(name: string, value: string): Promise<void> {
    name = validateString(name, "name");
    value = validateString(value, "value");
    this.storage().setItem(name, value);
  }

  async removeItem(name: string): Promise<void> {
    name = validateString(name, "name");
    this.storage().removeItem(name);
  }

  async clear(): Promise<void> {
    this.storage().clear();
  }

  private storage(): Storage {
    return this.kind === "local"
      ? this.page.window.localStorage
      : this.page.window.sessionStorage;
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

  modifierState(): string[] {
    return [...this.pressedModifiers];
  }

  // Pinned server/input.ts Keyboard.ensureModifiers, using our existing
  // key-state machine rather than inventing a second modifier implementation.
  async ensureModifiers(
    modifiers: readonly string[],
    deadline?: ActionDeadline
  ): Promise<void> {
    const desired = new Set(
      modifiers.map((key) => resolveKeyboardKey(key, this.page.window))
    );
    for (const key of ["Alt", "Control", "Meta", "Shift"]) {
      if (desired.has(key) === this.pressedModifiers.has(key)) continue;
      if (desired.has(key)) await this.down(key, deadline);
      else await this.up(key, deadline);
    }
  }

  async down(key: string, deadline?: ActionDeadline): Promise<void> {
    await this.downForTarget(key, deadline);
  }

  async up(key: string, deadline?: ActionDeadline): Promise<void> {
    await this.upForTarget(key, deadline);
  }

  async insertText(text: string, deadline?: ActionDeadline): Promise<void> {
    this.page.insertKeyboardText(
      this.activeTarget(),
      text,
      "insertText",
      text,
      deadline
    );
  }

  async type(
    text: string,
    options: { delay?: number } = {},
    deadline?: ActionDeadline
  ): Promise<void> {
    const delay = options.delay || undefined;
    for (const character of text) {
      if (keyboardLayout.has(character))
        await this.press(character, { delay }, deadline);
      else {
        if (delay) await this.page.waitKeyboardDelay(delay, deadline);
        await this.insertText(character, deadline);
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
    const modifiers = tokens.slice(0, -1);
    // The pinned Keyboard leaves a key down when the progress aborts during
    // the delay, because the controlled browser owns the real key state.
    // Here these sets are the only key state, so an interrupted press
    // releases what it pressed instead of leaking a repeat or a stuck
    // modifier into later operations. Cleanup dispatches no keyup, keeping
    // the aborted press's event sequence identical to the pinned one.
    const held = new Set<string>();
    try {
      for (const modifier of modifiers) {
        held.add(modifier);
        await this.down(modifier, deadline);
      }
      held.add(target);
      await this.down(target, deadline);
      if (options.delay)
        await this.page.waitKeyboardDelay(options.delay, deadline);
      await this.up(target, deadline);
      held.delete(target);
      for (const modifier of modifiers.reverse()) {
        await this.up(modifier, deadline);
        held.delete(modifier);
      }
    } catch (error) {
      this.releaseKeys(held);
      throw error;
    }
  }

  private releaseKeys(keys: Iterable<string>): void {
    for (const key of keys) {
      const description = keyboardLayout.get(
        resolveKeyboardKey(key, this.page.window)
      );
      if (!description) continue;
      this.pressedKeys.delete(description.code);
      this.keydownState.delete(description.code);
      if (isModifier(description.key))
        this.pressedModifiers.delete(description.key);
    }
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
    message === "Element is outside of the viewport" ||
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

/** Returns the normalized `delay`, unwrapped like the pointer options. */
function assertPageActionOptions(
  method: string,
  options: Record<string, unknown> | undefined,
  supported: string[] = []
): number | undefined {
  if (!options) return undefined;
  const unsupported = Object.keys(options).filter(
    (key) =>
      options[key] !== undefined &&
      key !== "signal" &&
      key !== "timeout" &&
      !supported.includes(key)
  );
  if (unsupported.length > 0)
    throw new Error(
      `${method}(): unsupported options: ${unsupported.join(", ")}. ` +
        `Unsupported Playwright option(s) are not supported by the single-document adapter.`
    );
  validateSignal(method, options.signal);
  if (options.timeout !== undefined)
    validateTimeout(options.timeout, `${method} timeout`);
  if (supported.includes("noWaitAfter"))
    validateNoWaitAfter(method, options.noWaitAfter);
  const delay = supported.includes("delay")
    ? validateDelay(options.delay)
    : undefined;
  if (
    supported.includes("strict") &&
    options.strict !== undefined &&
    typeof options.strict !== "boolean"
  )
    throw new TypeError(`${method} strict must be a boolean`);
  return delay;
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
): PointerActionOptions {
  const supported = [
    "signal",
    "noWaitAfter",
    "position",
    "trial",
    "force",
    "scroll",
    "strict",
  ];
  if (method === "click" || method === "dblclick")
    supported.push("button", "delay", "modifiers");
  if (method === "click") supported.push("clickCount");
  if (method === "hover") supported.push("modifiers");
  if (!options) return {};
  options = { ...options };
  // Pinned tBoolean/tFloat/tInt unwrap primitive objects without mutating
  // the caller's options. Enum values deliberately are not coerced.
  for (const key of ["trial", "force", "strict"] as const) {
    const value: unknown = options[key];
    if (value instanceof Boolean) options[key] = value.valueOf();
  }
  for (const key of ["delay", "clickCount"] as const) {
    const value: unknown = options[key];
    if (value instanceof Number) options[key] = value.valueOf();
  }
  const unsupported = Object.keys(options).filter(
    (key) =>
      options[key as keyof PointerActionOptions] !== undefined &&
      key !== "timeout" &&
      !supported.includes(key)
  );
  if (unsupported.length)
    throw new Error(
      `${method}(): unsupported Playwright option(s): ${unsupported.join(", ")}`
    );
  assertPageActionOptions(method, options, supported);
  for (const key of ["trial", "force", "strict"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      throw new TypeError(`${method} ${key} must be a boolean`);
  if (
    options.button !== undefined &&
    !["left", "middle", "right"].includes(options.button)
  )
    throw new TypeError("button: expected one of (left|right|middle)");
  if (
    options.scroll !== undefined &&
    !["auto", "none"].includes(options.scroll)
  )
    throw new TypeError("scroll: expected one of (auto|none)");
  for (const key of ["delay", "clickCount"] as const)
    if (
      options[key] !== undefined &&
      (typeof options[key] !== "number" || !Number.isFinite(options[key]))
    )
      throw new TypeError(`${key}: expected number`);
  if (options.clickCount !== undefined && !Number.isInteger(options.clickCount))
    throw new TypeError(
      `clickCount: expected integer, got float ${options.clickCount}`
    );
  if (
    options.modifiers !== undefined &&
    (!Array.isArray(options.modifiers) ||
      options.modifiers.some(
        (value) =>
          !["Alt", "Control", "ControlOrMeta", "Meta", "Shift"].includes(value)
      ))
  )
    throw new TypeError("modifiers: expected an array of keyboard modifiers");
  if (
    options.position !== undefined &&
    (!options.position ||
      typeof options.position.x !== "number" ||
      !Number.isFinite(options.position.x) ||
      typeof options.position.y !== "number" ||
      !Number.isFinite(options.position.y))
  )
    throw new TypeError(`${method} position must have finite x and y numbers`);
  return options;
}

function assertAriaSnapshotOptions(options: AriaSnapshotOptions) {
  queryTimeout(options.timeout);
  validateSignal("ARIA snapshot", options.signal);
}

function assertQueryOptions(
  options: SelectorQueryOptions | undefined,
  allowed: readonly (keyof SelectorQueryOptions)[]
) {
  if (!options) return;
  for (const key of Object.keys(options)) {
    // An undefined signal reads as absent, also where signal is unsupported.
    if (key === "signal" && options.signal === undefined) continue;
    if (!(allowed as readonly string[]).includes(key))
      throw new Error(`Unsupported query option: ${key}`);
  }
  validateSignal("Query", options.signal);
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
      key !== "signal" &&
      key !== "state" &&
      key !== "timeout" &&
      !(allowsStrict && key === "strict")
    )
      throw new Error(`Unsupported waitForSelector option: ${key}`);
  }
  validateSignal("waitForSelector", options.signal);
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

function actionAborted(signal: AbortSignal, inFlight: boolean): Error {
  const reason = abortReason(signal);
  const error = new Error(
    inFlight
      ? `${reason}\nCall log:\n  - operation was aborted: ${reason}`
      : "The operation was aborted",
    { cause: signal.reason }
  );
  error.name = "AbortError";
  return error;
}

export async function withAbortPrefix<T>(
  apiName: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw prefixAbortError(error, apiName);
  }
}

function prefixAbortError(error: unknown, apiName: string): unknown {
  const result = asError(error);
  if (result.name !== "AbortError") return error;
  result.message = `${apiName}: ${result.message}`;
  return result;
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
