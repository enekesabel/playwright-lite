import { assertEvaluationOptions, assertMaxArguments } from "./evaluation";
import type { EvaluationFunction, EvaluationOptions } from "./evaluation";
import { rejectUnsupportedOptions, validateForce } from "./protocolValidation";
import type { InputFiles } from "./inputFiles";
import type { PageImpl, SelectOptionValue } from "./page";
import { withAbortPrefix } from "./page";
import type { ElementHandle } from "@playwright/test";

type ElementHandleWaitOptions = { signal?: AbortSignal; timeout?: number };
type ElementHandleSelectorWaitOptions = ElementHandleWaitOptions & {
  state?: "attached" | "detached" | "visible" | "hidden";
};

/**
 * A browser-native, fixed reference to one element in the controlled document.
 *
 * This deliberately is not a Locator: selector operations below remain scoped
 * to `element`, even after the document replaces a matching node.
 */
export class AdapterElementHandle {
  private disposed = false;

  constructor(
    private readonly ownerPage: PageImpl,
    private element: Element | undefined
  ) {}

  async click(options?: Parameters<ElementHandle["click"]>[0]): Promise<void> {
    await this.ownerPage.clickSelector(
      this.requireElement(),
      "elementHandle.click",
      options?.timeout,
      undefined,
      options
    );
  }

  async dblclick(
    options?: Parameters<ElementHandle["dblclick"]>[0]
  ): Promise<void> {
    await this.ownerPage.dblclickSelector(
      this.requireElement(),
      "elementHandle.dblclick",
      options
    );
  }

  async hover(options?: Parameters<ElementHandle["hover"]>[0]): Promise<void> {
    await this.ownerPage.hoverSelector(
      this.requireElement(),
      "elementHandle.hover",
      options?.timeout,
      undefined,
      options
    );
  }

  async check(options?: Parameters<ElementHandle["check"]>[0]): Promise<void> {
    await this.ownerPage.setCheckedSelector(
      this.requireElement(),
      true,
      "elementHandle.check",
      options,
      undefined,
      "check"
    );
  }

  async uncheck(
    options?: Parameters<ElementHandle["uncheck"]>[0]
  ): Promise<void> {
    await this.ownerPage.setCheckedSelector(
      this.requireElement(),
      false,
      "elementHandle.uncheck",
      options,
      undefined,
      "uncheck"
    );
  }

  async setChecked(
    checked: boolean,
    options?: Parameters<ElementHandle["setChecked"]>[1]
  ): Promise<void> {
    await this.ownerPage.setCheckedSelector(
      this.requireElement(),
      checked,
      "elementHandle.setChecked",
      options
    );
  }

  async fill(
    value: string,
    options?: Parameters<ElementHandle["fill"]>[1]
  ): Promise<void> {
    rejectUnsupportedOptions("fill", options, [
      "force",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    const force = validateForce("fill", options?.force);
    await withAbortPrefix("elementHandle.fill", () =>
      this.ownerPage.fillSelector(
        this.requireElement(),
        value,
        "elementHandle.fill",
        options?.timeout,
        undefined,
        true,
        options?.signal,
        "fill",
        force
      )
    );
  }

  async focus(): Promise<void> {
    await this.ownerPage.focusSelector(
      this.requireElement(),
      "elementHandle.focus"
    );
  }

  async type(
    text: string,
    options?: Parameters<ElementHandle["type"]>[1]
  ): Promise<void> {
    rejectUnsupportedOptions("type", options, [
      "delay",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("elementHandle.type", () =>
      this.ownerPage.typeSelector(
        this.requireElement(),
        text,
        options,
        "elementHandle.type",
        true
      )
    );
  }

  async selectOption(
    values: string | SelectOptionValue | (string | SelectOptionValue)[] | null,
    options?: Parameters<ElementHandle["selectOption"]>[1]
  ): Promise<string[]> {
    rejectUnsupportedOptions("selectOption", options, [
      "force",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    const force = validateForce("selectOption", options?.force);
    return withAbortPrefix("elementHandle.selectOption", () =>
      this.ownerPage.selectOptionSelector(
        this.requireElement(),
        values,
        "elementHandle.selectOption",
        options?.timeout,
        undefined,
        true,
        options?.signal,
        force
      )
    );
  }

  async setInputFiles(
    files: InputFiles,
    options?: Parameters<ElementHandle["setInputFiles"]>[1]
  ): Promise<void> {
    rejectUnsupportedOptions("setInputFiles", options, [
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("elementHandle.setInputFiles", () =>
      this.ownerPage.setInputFilesSelector(
        this.requireElement(),
        files,
        options,
        true,
        "elementHandle.setInputFiles"
      )
    );
  }

  async dispatchEvent(type: string, eventInit: object = {}): Promise<void> {
    await this.ownerPage.dispatchEventSelector(
      this.requireElement(),
      type,
      eventInit,
      "elementHandle.dispatchEvent"
    );
  }

  async press(
    key: string,
    options?: Parameters<ElementHandle["press"]>[1]
  ): Promise<void> {
    const delay = rejectUnsupportedOptions("press", options, [
      "delay",
      "noWaitAfter",
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("elementHandle.press", () =>
      this.ownerPage.pressSelector(
        this.requireElement(),
        key,
        "elementHandle.press",
        options?.timeout,
        undefined,
        true,
        options?.signal,
        delay
      )
    );
  }

  async selectText(
    options?: Parameters<ElementHandle["selectText"]>[0]
  ): Promise<void> {
    rejectUnsupportedOptions("selectText", options, [
      "force",
      "signal",
      "timeout",
    ]);
    const force = validateForce("selectText", options?.force);
    await withAbortPrefix("elementHandle.selectText", () =>
      this.ownerPage.selectText(
        this.requireElement(),
        "elementHandle.selectText",
        options?.timeout,
        undefined,
        options?.signal,
        force
      )
    );
  }

  async scrollIntoViewIfNeeded(
    options?: Parameters<ElementHandle["scrollIntoViewIfNeeded"]>[0]
  ): Promise<void> {
    rejectUnsupportedOptions("scrollIntoViewIfNeeded", options, [
      "signal",
      "timeout",
    ]);
    await withAbortPrefix("elementHandle.scrollIntoViewIfNeeded", () =>
      this.ownerPage.scrollLocatorIntoView(
        this.requireElement(),
        "elementHandle.scrollIntoViewIfNeeded",
        options?.timeout,
        undefined,
        options?.signal
      )
    );
  }

  async $(selector: string): Promise<AdapterElementHandle | null> {
    return this.ownerPage.elementHandleFor(
      this.ownerPage.resolveWithinElement(
        this.requireElement(),
        selector,
        false
      )
    );
  }

  async $$(selector: string): Promise<AdapterElementHandle[]> {
    return this.ownerPage
      .resolveAllWithinElement(this.requireElement(), selector)
      .map((element) => this.ownerPage.elementHandleFor(element)!);
  }

  async $eval<T>(
    selector: string,
    pageFunction: EvaluationFunction<T>,
    arg?: unknown
  ): Promise<T> {
    assertMaxArguments(arguments.length, 3);
    const element = this.ownerPage.resolveWithinElement(
      this.requireElement(),
      selector,
      false
    );
    if (!element)
      throw new Error(`Failed to find element matching selector "${selector}"`);
    return this.ownerPage.evaluation.byValue(
      pageFunction,
      typeof pageFunction === "function",
      arg,
      element
    );
  }

  async $$eval<T>(
    selector: string,
    pageFunction: EvaluationFunction<T>,
    arg?: unknown
  ): Promise<T> {
    assertMaxArguments(arguments.length, 3);
    return this.ownerPage.evaluation.byValue(
      pageFunction,
      typeof pageFunction === "function",
      arg,
      this.ownerPage.resolveAllWithinElement(this.requireElement(), selector)
    );
  }

  async evaluate<T>(
    pageFunction: EvaluationFunction<T>,
    arg?: unknown,
    options?: EvaluationOptions
  ): Promise<T> {
    assertMaxArguments(arguments.length, 3);
    assertEvaluationOptions(options);
    return this.ownerPage.evaluation.byValue(
      pageFunction,
      typeof pageFunction === "function",
      arg,
      this.requireElement()
    );
  }

  async textContent(): Promise<string | null> {
    return this.requireElement().textContent;
  }

  async innerText(): Promise<string> {
    const element = this.requireElement();
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml")
      throw new Error("Node is not an HTMLElement");
    return (element as HTMLElement).innerText;
  }

  async innerHTML(): Promise<string> {
    return this.requireElement().innerHTML;
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.requireElement().getAttribute(name);
  }

  async inputValue(): Promise<string> {
    return this.ownerPage.inputValueForElement(this.requireElement());
  }

  asElement(): AdapterElementHandle {
    return this;
  }

  async isEnabled(): Promise<boolean> {
    return this.ownerPage.elementStateForHandle(
      this.requireElement(),
      "enabled"
    );
  }

  async isDisabled(): Promise<boolean> {
    return this.ownerPage.elementStateForHandle(
      this.requireElement(),
      "disabled"
    );
  }

  async isVisible(): Promise<boolean> {
    const element = this.requireElement();
    if (!element.isConnected) return false;
    return this.ownerPage.elementState(element, "visible").matches;
  }

  async isHidden(): Promise<boolean> {
    return !(await this.isVisible());
  }

  async isEditable(): Promise<boolean> {
    return this.ownerPage.elementStateForHandle(
      this.requireElement(),
      "editable"
    );
  }

  async isChecked(): Promise<boolean> {
    return this.ownerPage.elementStateForHandle(
      this.requireElement(),
      "checked"
    );
  }

  async boundingBox(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> {
    return this.ownerPage.boundingBoxForElement(this.requireElement());
  }

  async waitForElementState(
    state:
      "visible" | "hidden" | "stable" | "enabled" | "disabled" | "editable",
    options: ElementHandleWaitOptions = {}
  ): Promise<void> {
    await withAbortPrefix("elementHandle.waitForElementState", () =>
      this.ownerPage.waitForElementState(this.requireElement(), state, options)
    );
  }

  async waitForSelector(
    selector: string,
    options: ElementHandleSelectorWaitOptions = {}
  ): Promise<AdapterElementHandle | null> {
    return await this.ownerPage.waitForSelectorWithinElement(
      this.requireElement(),
      selector,
      options
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.element = undefined;
  }

  /** Internal boundary used only by Page evaluation argument unwrapping. */
  elementForEvaluation(ownerPage: PageImpl): Element {
    if (ownerPage !== this.ownerPage)
      throw new Error("ElementHandle belongs to a different Page");
    return this.requireElement();
  }

  private requireElement(): Element {
    if (this.disposed) throw new Error("ElementHandle has been disposed");
    if (!this.element) throw new Error("ElementHandle has been disposed");
    return this.element;
  }
}
