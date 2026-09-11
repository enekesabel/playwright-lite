import type { PageImpl } from "./page";

type ElementHandleWaitOptions = { timeout?: number };
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
    pageFunction: (element: Element, arg?: unknown) => T | Promise<T>,
    arg?: unknown
  ): Promise<T> {
    const element = this.ownerPage.resolveWithinElement(
      this.requireElement(),
      selector,
      false
    );
    if (!element)
      throw new Error(`Failed to find element matching selector "${selector}"`);
    return await pageFunction(
      element,
      this.ownerPage.unwrapElementHandleArg(arg)
    );
  }

  async $$eval<T>(
    selector: string,
    pageFunction: (elements: Element[], arg?: unknown) => T | Promise<T>,
    arg?: unknown
  ): Promise<T> {
    return await pageFunction(
      this.ownerPage.resolveAllWithinElement(this.requireElement(), selector),
      this.ownerPage.unwrapElementHandleArg(arg)
    );
  }

  async evaluate<T>(
    pageFunction: (element: Element, arg?: unknown) => T | Promise<T>,
    arg?: unknown
  ): Promise<T> {
    return await pageFunction(
      this.requireElement(),
      this.ownerPage.unwrapElementHandleArg(arg)
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
    await this.ownerPage.waitForElementState(
      this.requireElement(),
      state,
      options
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
