from pathlib import Path
import re

root = Path.cwd()
def replace(path, before, after):
    p = root / path
    text = p.read_text()
    assert text.count(before) == 1, (path, before[:80], text.count(before))
    p.write_text(text.replace(before, after))

def section(path, start, end, content):
    p = root / path
    text = p.read_text()
    a = text.index(start)
    b = text.index(end, a)
    p.write_text(text[:a] + content + text[b:])

page = 'src/page.ts'
replace(page, '''export type PointerActionOptions = PageActionWithNoWaitAfterOptions & {
  position?: ActionPoint;
  trial?: boolean;
};''', '''export type PointerActionOptions = NonNullable<Parameters<Page["click"]>[1]>;
export type HoverActionOptions = NonNullable<Parameters<Page["hover"]>[1]>;
export type DoubleClickActionOptions = NonNullable<Parameters<Page["dblclick"]>[1]>;
export type CheckedActionOptions = NonNullable<Parameters<Page["check"]>[1]>;''')
replace(page, '  retarget(element: Element, behavior: "follow-label"): Element | null;', '  retarget(element: Element, behavior: "follow-label" | "button-link"): Element | null;')
replace(page, '''  fill(
    element: Element,''', '''  setupHitTargetInterceptor(
    element: Element,
    action: "hover" | "mouse",
    point: ActionPoint,
    trial: boolean
  ): string | { stop(): "done" | { hitTargetDescription: string } };
  fill(
    element: Element,''')
replace(page, '  private defaultTimeout: number | undefined;', '  private pointerTarget: Element | undefined;\n  private defaultTimeout: number | undefined;')
section(page, '  async clickSelector(', '  async fillSelector(', '''  async clickSelector(
    selector: string | Element,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    options: PointerActionOptions = {}
  ): Promise<void> {
    assertPointerActionOptions("click", options);
    await this.performPointerAction(selector, label, "click", options, deadline);
  }

  async dblclickSelector(
    selector: string | Element,
    label: string,
    options: DoubleClickActionOptions = {},
    deadline = this.createActionDeadline(options.timeout)
  ): Promise<void> {
    assertPointerActionOptions("dblclick", options);
    await this.performPointerAction(selector, label, "dblclick", options, deadline);
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
    checked?: boolean
  ): Promise<void> {
    try {
      while (true) {
        this.assertActionDeadline(deadline, action);
        try {
          if (checked !== undefined) {
            const candidate = this.resolvePointerElement(selector, label, options.strict ?? true);
            if (this.hasCheckedState(candidate, checked)) return;
          }
          const target = await this.retryActionability(
            selector, label, action,
            action === "hover" ? ["visible", "stable"] : ["visible", "enabled", "stable"],
            true, deadline, options.position, options
          );
          // A Locator may have resolved a replacement while waiting. Never
          // toggle it when its checked state already satisfies the request.
          if (checked !== undefined && this.hasCheckedState(target.element, checked)) return;
          let interceptor: { stop(): "done" | { hitTargetDescription: string } } | undefined;
          if (!options.force) {
            const result = this.actionableInjected.setupHitTargetInterceptor(
              target.element, action === "hover" ? "hover" : "mouse", target.point, !!options.trial
            );
            if (typeof result === "string")
              throw new Error(result === "error:notconnected" ? "Element is not connected" : `Element does not receive pointer events: ${result}`);
            interceptor = result;
          }
          const previousModifiers = this.keyboard.modifierState();
          let interception: "done" | { hitTargetDescription: string } = "done";
          try {
            if (options.modifiers) await this.keyboard.ensureModifiers(options.modifiers, deadline);
            this.assertActionDeadline(deadline, action);
            await this.movePointer(target.point, deadline, action);
            if (!options.trial && action !== "hover")
              await this.dispatchClick(target.element, target.point, action === "dblclick" ? 2 : options.clickCount ?? 1, options, deadline, action);
          } finally {
            interception = interceptor?.stop() ?? "done";
            // Cleanup is not input activation and must also run after timeout.
            if (options.modifiers) await this.keyboard.ensureModifiers(previousModifiers);
          }
          if (interception !== "done")
            throw new Error(`Element does not receive pointer events: ${interception.hitTargetDescription}`);
          if (!options.trial && checked !== undefined && !this.hasCheckedState(target.element, checked))
            throw new Error("Clicking the checkbox did not change its state");
          return;
        } catch (error) {
          if (typeof selector !== "string" && !selector.isConnected)
            throw new Error("Element is not attached to the DOM");
          // The preflight loop handles state/geometry. Only retry a target
          // replacement or interception discovered between preflight and input.
          const message = asError(error).message;
          if (options.force || !(message === "Element is not connected" || message.startsWith("Element does not receive pointer events") || message.startsWith("No elements found for locator")))
            throw error;
          await this.waitWithinActionDeadline(ACTION_RETRY_DELAY, deadline, action);
        }
      }
    } catch (error) {
      const result = asError(error);
      const method = label.match(/^(page|elementHandle)\\.(click|dblclick|hover|check|uncheck|setChecked)(?:\\(|$)/);
      const prefix = method ? `${method[1]}.${method[2]}` : `locator.${action}`;
      result.message = `${prefix}: ${result.message.replace(new RegExp(`^${action}: `), "")}`;
      throw result;
    }
  }

  private resolvePointerElement(subject: string | Element, label: string, strict: boolean): Element {
    if (typeof subject === "string") return this.queryElement(subject, label, strict);
    if (!subject.isConnected) throw new Error("Element is not attached to the DOM");
    return subject;
  }

  private hasCheckedState(element: Element, checked: boolean): boolean {
    const state = (this.injected as typeof this.injected & QueryCapableInjectedScript).elementState(element, "checked");
    if (state.received === "error:notconnected") throw new Error("Element is not connected");
    if (state.matches === checked) return true;
    if (!checked && state.isRadio)
      throw new Error("Cannot uncheck radio button. Radio buttons can only be unchecked by selecting another radio button in the same group.");
    return state.matches === checked;
  }

''')
section(page, '  async hoverSelector(', '  async selectOptionSelector(', '''  async hoverSelector(
    selector: string | Element,
    label: string,
    timeout?: number,
    deadline = this.createActionDeadline(timeout),
    options: HoverActionOptions = {}
  ): Promise<void> {
    assertPointerActionOptions("hover", options);
    await this.performPointerAction(selector, label, "hover", options, deadline);
  }

  async setCheckedSelector(
    selector: string | Element,
    checked: boolean,
    label: string,
    options: CheckedActionOptions = {},
    deadline = this.createActionDeadline(options.timeout)
  ): Promise<void> {
    assertPointerActionOptions("setChecked", options);
    if (typeof checked !== "boolean") throw new TypeError("checked must be a boolean");
    await this.performPointerAction(selector, label, "click", options, deadline, checked);
  }

''')
# Page is non-strict by default; Locators below continue to force strict resolution.
replace(page, '''      options?.timeout,
      undefined,
      options
    );
  }

  async fill(''', '''      options?.timeout,
      undefined,
      { ...options, strict: options?.strict ?? false }
    );
  }

  async fill(''')
section(page, '  async hover(\n', '  async selectOption(\n', '''  async hover(
    selector: string,
    options?: HoverActionOptions
  ): Promise<void> {
    await this.hoverSelector(selector, `page.hover(${JSON.stringify(selector)})`, options?.timeout, undefined, { ...options, strict: options?.strict ?? false });
  }

''')
for method in ['check', 'uncheck', 'setChecked']:
    a=(root/page).read_text().index('  async '+method+'(')
    text=(root/page).read_text();b=text.index('\n  async ',a+5)
    chunk=text[a:b].replace('options?: PointerActionOptions', 'options?: CheckedActionOptions').replace('      options\n', '      { ...options, strict: options?.strict ?? false }\n')
    (root/page).write_text(text[:a]+chunk+text[b:])
a=(root/page).read_text().index('  async dblclick(\n');text=(root/page).read_text();b=text.index('\n  async ',a+5)
chunk=text[a:b].replace('options?: PointerActionOptions','options?: DoubleClickActionOptions').replace('      options\n','      { ...options, strict: options?.strict ?? false }\n')
(root/page).write_text(text[:a]+chunk+text[b:])
# Keep the existing general actionability loop, extending only pointer cases.
replace(page, '''  private async retryActionability(
    selector: string,''', '''  private async retryActionability(
    selector: string | Element,''')
replace(page, '''    deadline: ActionDeadline,
    position?: ActionPoint
  ): Promise<ActionTarget> {
    let lastError: Error | undefined;''', '''    deadline: ActionDeadline,
    position?: ActionPoint,
    pointerOptions?: PointerActionOptions
  ): Promise<ActionTarget> {
    let lastError: Error | undefined;
    let retry = 0;
    const log: string[] = [];
    const timeoutError = () => new AdapterTimeoutError(
      `${actionName}: Timeout ${deadline.timeout}ms exceeded.${lastError ? ` ${lastError.message}` : ""}` +
      (pointerOptions ? `\\nCall log:\\n  - attempting ${actionName} action${pointerOptions.trial ? " (trial run)" : ""}\\n${log.join("\\n")}` : ""),
      { cause: lastError }
    );''')
replace(page, '''      if (lastError)
        throw new AdapterTimeoutError(
          `${actionName}: Timeout ${deadline.timeout}ms exceeded. ${lastError.message}`,
          { cause: lastError }
        );''', '''      if (lastError) throw timeoutError();''')
replace(page, '''        const element = this.requireSingle(selector, label);
        await this.ensureActionable(element, states, deadline);
        if (Date.now() >= deadline.expiresAt) throwTimeout();
        if (actionName !== "scroll into view")
          this.scrollIntoView(element, position);
        // Scrolling can change visibility or expose a covering element.
        await this.ensureActionable(element, states, deadline);
        const point = checkHitTarget
          ? this.ensureReceivesEvents(element, position)
          : actionPoint(element, position, this.window);''', '''        const element = this.resolvePointerElement(selector, label, pointerOptions?.strict ?? true);
        if (!pointerOptions?.force) await this.ensureActionable(element, states, deadline);
        if (Date.now() >= deadline.expiresAt) throwTimeout();
        if (actionName !== "scroll into view" && pointerOptions?.scroll !== "none") {
          if (!pointerOptions || position) this.scrollIntoView(element, position);
          else if (retry % 4 === 0) this.scrollIntoViewIfNeeded(element);
          else element.scrollIntoView({ block: (["end", "center", "start"] as const)[(retry - 1) % 4], inline: (["end", "center", "start"] as const)[(retry - 1) % 4], behavior: "instant" });
        }
        // Scrolling can change visibility or expose a covering element.
        if (!pointerOptions?.force) await this.ensureActionable(element, states, deadline);
        const point = checkHitTarget
          ? this.ensureReceivesEvents(element, position, !!pointerOptions?.force)
          : actionPoint(element, position, this.window);''')
replace(page, '''      } catch (error) {
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

  private scrollIntoView(''', '''      } catch (error) {
        if (typeof selector !== "string" && !selector.isConnected)
          throw new Error("Element is not attached to the DOM");
        if (!isRetryableActionError(error) || pointerOptions?.force) throw error;
        lastError = asError(error);
        const remaining = deadline.expiresAt - Date.now();
        const delay = pointerOptions ? [0, 20, 100, 100, 500][Math.min(retry++, 4)] : ACTION_RETRY_DELAY;
        if (pointerOptions) {
          const reason = lastError.message.replace(/^Element/, "element").replace(/^element does not receive pointer events: (.*)$/, "$1 intercepts pointer events");
          log.push(`  - ${reason}`, `  - retrying ${actionName} action`, `  - waiting ${delay}ms`);
          if (log.length > 60) log.splice(0, 3);
        }
        if (remaining <= 0) throw timeoutError();
        await this.wait(Math.min(delay, remaining));
      }
    }
  }

  private scrollIntoView(''')
section(page, '  private ensureReceivesEvents(', '  private focusElement(', '''  private ensureReceivesEvents(element: Element, position?: ActionPoint, force = false): ActionPoint {
    const point = this.pointerPoint(element, position);
    if (force) return point;
    // Same retargeting as dom.ts setupHitTargetInterceptor, not a custom
    // ancestor heuristic: nested labels/buttons/links retain pinned semantics.
    const target = (this.injected as typeof this.injected & QueryCapableInjectedScript).retarget(element, "button-link");
    if (!target) throw new Error("Element is not connected");
    const result = this.actionableInjected.expectHitTarget(point, target);
    if (result !== "done") throw new Error(`Element does not receive pointer events: ${result.hitTargetDescription}`);
    return point;
  }

  private pointerPoint(element: Element, position?: ActionPoint): ActionPoint {
    if (!element.isConnected) throw new Error("Element is not connected");
    let rects = Array.from(element.getClientRects());
    if (!rects.length && this.window.getComputedStyle(element).display === "contents") {
      const range = this.document.createRange();
      range.selectNodeContents(element);
      rects = Array.from(range.getClientRects());
    }
    if (!rects.length) throw new Error("Element is not visible");
    const width = this.document.documentElement.clientWidth;
    const height = this.document.documentElement.clientHeight;
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
      const left = Math.max(0, rect.left), right = Math.min(width, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(height, rect.bottom);
      if (right > left && bottom > top && (right - left) * (bottom - top) > 0.99)
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
    throw new Error("Element is outside of the viewport");
  }

  private async pointerTask<T>(deadline: ActionDeadline, action: string, task: () => T): Promise<T> {
    // Like pinned WebViewInput._postTask, each event is a browser task. Check
    // the shared deadline inside the task, so expiration cannot activate later.
    return new Promise<T>((resolve, reject) => this.window.setTimeout(() => {
      try {
        this.assertActionDeadline(deadline, action);
        resolve(task());
      } catch (error) { reject(error); }
    }));
  }

  private async movePointer(point: ActionPoint, deadline: ActionDeadline, action: string) {
    const target = this.eventTargetAtPoint(point);
    const previous = this.pointerTarget;
    if (previous !== target && previous?.isConnected) {
      await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(previous, "pointerout", point, -1, 0, 0, true, target));
      await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(previous, "pointerleave", point, -1, 0, 0, false, target));
      await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(previous, "mouseout", point, 0, 0, 0, true, target));
      await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(previous, "mouseleave", point, 0, 0, 0, false, target));
    }
    this.pointerTarget = target;
    if (previous !== target) {
      await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(target, "pointerover", point, -1, 0, 0, true, previous));
      await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(target, "pointerenter", point, -1, 0, 0, false, previous));
      await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(target, "mouseover", point, 0, 0, 0, true, previous));
      await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(target, "mouseenter", point, 0, 0, 0, false, previous));
    }
    await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(this.eventTargetAtPoint(point), "pointermove", point, -1, 0, 0));
    await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(this.eventTargetAtPoint(point), "mousemove", point, 0, 0, 0));
  }

  private async dispatchClick(
    element: Element,
    point: ActionPoint,
    clickCount: number,
    options: PointerActionOptions,
    deadline: ActionDeadline,
    action: string
  ) {
    const button = options.button === "right" ? 2 : options.button === "middle" ? 1 : 0;
    const buttons = button === 0 ? 1 : button === 1 ? 4 : 2;
    for (let detail = 1; detail <= clickCount; detail++) {
      if (!element.isConnected) throw new Error("Element is not connected");
      const downTarget = this.eventTargetAtPoint(point);
      const pointerDownAllowed = await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(this.eventTargetAtPoint(point), "pointerdown", point, button, buttons, 0));
      if (pointerDownAllowed) {
        await this.pointerTask(deadline, action, () => {
          const target = this.eventTargetAtPoint(point);
          const allowed = this.dispatchMouseEvent(target, "mousedown", point, button, buttons, detail);
          this.assertActionDeadline(deadline, action);
          if (allowed) this.focusPointerTarget(target);
        });
      }
      if (button === 2)
        await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(this.eventTargetAtPoint(point), "contextmenu", point, button, buttons, detail));
      await this.waitWithinActionDeadline(options.delay, deadline, action);
      await this.pointerTask(deadline, action, () => this.dispatchPointerEvent(this.eventTargetAtPoint(point), "pointerup", point, button, 0, 0));
      if (pointerDownAllowed)
        await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(this.eventTargetAtPoint(point), "mouseup", point, button, 0, detail));
      await this.pointerTask(deadline, action, () => {
        const upTarget = this.eventTargetAtPoint(point);
        let target: Element | null = downTarget;
        while (target && !target.contains(upTarget)) target = target.parentElement;
        if (target?.isConnected) this.dispatchMouseEvent(target, button === 0 ? "click" : "auxclick", point, button, 0, detail);
      });
      if (detail === 2)
        await this.pointerTask(deadline, action, () => this.dispatchMouseEvent(this.eventTargetAtPoint(point), "dblclick", point, button, 0, detail));
      if (detail < clickCount) await this.waitWithinActionDeadline(options.delay, deadline, action);
    }
  }

  private eventTargetAtPoint(point: ActionPoint): Element {
    let target = this.document.elementFromPoint(point.x, point.y) ?? this.document.documentElement;
    while (target.shadowRoot?.mode === "open") {
      const inner = target.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === target) break;
      target = inner;
    }
    return target;
  }

  private focusPointerTarget(element: Element) {
    const target = (this.injected as typeof this.injected & QueryCapableInjectedScript).retarget(element, "follow-label");
    // Real mouse focus does not scroll a different part of a large control
    // into view. InjectedScript.focusNode is the keyboard focus operation.
    if (target && typeof (target as HTMLElement).focus === "function")
      (target as HTMLElement).focus({ preventScroll: true });
  }

''')
# Preserve common dispatcher names, add protocol-correct mouse metadata and the
# pinned WebView marker used by InjectedScript's interception listener.
section(page, '  private dispatchPointerEvent(', '  dispatchKeyboardEvent(', '''  private dispatchPointerEvent(
    element: Element, type: string, point: ActionPoint, button: number,
    buttons: number, detail: number, bubbles = true, relatedTarget?: Element
  ): boolean {
    const event = new this.window.PointerEvent(type, {
      ...this.pointerEventInit(point, button, buttons, detail, bubbles, relatedTarget),
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      pressure: buttons ? 0.5 : 0,
    });
    Object.defineProperty(event, "__pwTrustedSynthetic", { value: true });
    return element.dispatchEvent(event);
  }

  private dispatchMouseEvent(
    element: Element, type: string, point: ActionPoint, button: number,
    buttons: number, detail: number, bubbles = true, relatedTarget?: Element
  ): boolean {
    const init = this.pointerEventInit(point, button, buttons, detail, bubbles, relatedTarget);
    const event = type === "click" || type === "auxclick"
      ? new this.window.PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
      : new this.window.MouseEvent(type, init);
    Object.defineProperty(event, "__pwTrustedSynthetic", { value: true });
    return element.dispatchEvent(event);
  }

  private pointerEventInit(point: ActionPoint, button: number, buttons: number, detail: number, bubbles: boolean, relatedTarget?: Element): MouseEventInit {
    const modifiers = this.keyboard.modifierState();
    return {
      bubbles, button, buttons, cancelable: true, composed: bubbles,
      clientX: point.x, clientY: point.y, detail, view: this.window,
      relatedTarget: relatedTarget ?? null,
      altKey: modifiers.includes("Alt"), ctrlKey: modifiers.includes("Control"),
      metaKey: modifiers.includes("Meta"), shiftKey: modifiers.includes("Shift"),
    };
  }

''')
replace(page, '''  constructor(private readonly page: PageImpl) {}

  async down''', '''  constructor(private readonly page: PageImpl) {}

  modifierState(): string[] { return [...this.pressedModifiers]; }

  // Pinned server/input.ts Keyboard.ensureModifiers, using our existing
  // key-state machine rather than inventing a second modifier implementation.
  async ensureModifiers(modifiers: readonly string[], deadline?: ActionDeadline): Promise<void> {
    const desired = new Set(modifiers.map((key) => resolveKeyboardKey(key, this.page.window)));
    for (const key of ["Alt", "Control", "Meta", "Shift"]) {
      if (desired.has(key) === this.pressedModifiers.has(key)) continue;
      if (desired.has(key)) await this.down(key, deadline);
      else await this.up(key, deadline);
    }
  }

  async down''')
section(page, 'function assertPointerActionOptions(', 'function assertAriaSnapshotOptions(', '''function assertPointerActionOptions(method: string, options: PointerActionOptions | undefined): void {
  const supported = ["noWaitAfter", "position", "trial", "force", "scroll", "strict"];
  if (method === "click" || method === "dblclick") supported.push("button", "delay", "modifiers");
  if (method === "click") supported.push("clickCount");
  if (method === "hover") supported.push("modifiers");
  if (!options) return;
  const unsupported = Object.keys(options).filter((key) => options[key as keyof PointerActionOptions] !== undefined && key !== "timeout" && !supported.includes(key));
  if (unsupported.length) throw new Error(`${method}(): unsupported Playwright option(s): ${unsupported.join(", ")}`);
  assertPageActionOptions(method, options, supported);
  for (const key of ["trial", "force", "strict"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw new TypeError(`${method} ${key} must be a boolean`);
  if (options.button !== undefined && !["left", "middle", "right"].includes(options.button)) throw new TypeError("button: expected one of (left|right|middle)");
  if (options.scroll !== undefined && !["auto", "none"].includes(options.scroll)) throw new TypeError("scroll: expected one of (auto|none)");
  for (const key of ["delay", "clickCount"] as const)
    if (options[key] !== undefined && (typeof options[key] !== "number" || !Number.isFinite(options[key]))) throw new TypeError(`${key}: expected number`);
  if (options.modifiers !== undefined && (!Array.isArray(options.modifiers) || options.modifiers.some((value) => !["Alt", "Control", "ControlOrMeta", "Meta", "Shift"].includes(value)))) throw new TypeError("modifiers: expected an array of keyboard modifiers");
  if (options.position !== undefined && (!options.position || typeof options.position.x !== "number" || !Number.isFinite(options.position.x) || typeof options.position.y !== "number" || !Number.isFinite(options.position.y))) throw new TypeError(`${method} position must have finite x and y numbers`);
}

''')
# ElementHandle methods share the same runtime, retaining a fixed DOM reference.
replace('src/elementHandle.ts', 'import type { PageImpl } from "./page";', 'import type { PageImpl } from "./page";\nimport type { ElementHandle } from "@playwright/test";')
replace('src/elementHandle.ts', '  async $(selector: string):', '''  async click(options?: Parameters<ElementHandle["click"]>[0]): Promise<void> {
    await this.ownerPage.clickSelector(this.requireElement(), "elementHandle.click", options?.timeout, undefined, options);
  }

  async dblclick(options?: Parameters<ElementHandle["dblclick"]>[0]): Promise<void> {
    await this.ownerPage.dblclickSelector(this.requireElement(), "elementHandle.dblclick", options);
  }

  async hover(options?: Parameters<ElementHandle["hover"]>[0]): Promise<void> {
    await this.ownerPage.hoverSelector(this.requireElement(), "elementHandle.hover", options?.timeout, undefined, options);
  }

  async check(options?: Parameters<ElementHandle["check"]>[0]): Promise<void> {
    await this.ownerPage.setCheckedSelector(this.requireElement(), true, "elementHandle.check", options);
  }

  async uncheck(options?: Parameters<ElementHandle["uncheck"]>[0]): Promise<void> {
    await this.ownerPage.setCheckedSelector(this.requireElement(), false, "elementHandle.uncheck", options);
  }

  async setChecked(checked: boolean, options?: Parameters<ElementHandle["setChecked"]>[1]): Promise<void> {
    await this.ownerPage.setCheckedSelector(this.requireElement(), checked, "elementHandle.setChecked", options);
  }

  async $(selector: string):''')
# Derive public signatures from the pin, with shared runtime option validation.
loc='src/locator.ts'
section(loc, '  async click(options?', '  async fill(', '''  async click(options?: Parameters<Locator["click"]>[0]) {
    await this.ownerPage.clickSelector(this.selector, this.label, options?.timeout, undefined, { ...options, strict: true });
  }

''')
section(loc, '  async hover(options?', '  async dispatchEvent(', '''  async hover(options?: Parameters<Locator["hover"]>[0]) {
    await this.ownerPage.hoverSelector(this.selector, this.label, options?.timeout, undefined, { ...options, strict: true });
  }

  async check(options?: Parameters<Locator["check"]>[0]) {
    await this.ownerPage.setCheckedSelector(this.selector, true, this.label, { ...options, strict: true });
  }

  async uncheck(options?: Parameters<Locator["uncheck"]>[0]) {
    await this.ownerPage.setCheckedSelector(this.selector, false, this.label, { ...options, strict: true });
  }

  async setChecked(checked: boolean, options?: Parameters<Locator["setChecked"]>[1]) {
    await this.ownerPage.setCheckedSelector(this.selector, checked, this.label, { ...options, strict: true });
  }

  async dblclick(options?: Parameters<Locator["dblclick"]>[0]) {
    await this.ownerPage.dblclickSelector(this.selector, this.label, { ...options, strict: true });
  }

''')
replace(loc, '  PointerActionOptions,\n', '')
# The old negative tests must keep testing an actually unsupported operation.
p=root/'src/contract.test.ts';text=p.read_text()
a=text.index('  describe("unsupported options",');b=text.index('    it("rejects action options other than timeout"',a)
text=text[:a]+text[a:b].replace('force','signal')+text[b:]
text=text.replace('dblclick({ force: true } as any)', 'dblclick({ signal: true } as any)').replace('"unsupported Playwright option(s): force"', '"unsupported Playwright option(s): signal"')
p.write_text(text)
# Limitations describe actual partial support, not an unconditional parity claim.
p=root/'compatibility/api.ts';text=p.read_text()
text=text.replace('Accepts timeout, noWaitAfter, position, and trial only. Does not wait for navigation.', 'Browser-local pointer events, button/clickCount/delay/modifiers, force, position, scroll and trial; no trusted input, AbortSignal transport or navigation waiting.')
text=text.replace('Accepts timeout, noWaitAfter, position, and trial only.', 'Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport.')
text=text.replace('hover: implemented("Accepts timeout and noWaitAfter only.")', 'hover: implemented("Browser-local pointer events with modifiers, force, position, scroll, timeout and trial; native CSS hover state is not emulated.")')
p.write_text(text)
