import type { Mouse } from "@playwright/test";

import {
  guardLifetimeCalls,
  type LifetimeCalls,
  type PageLifetime,
} from "./lifetime";
import type { ActionDeadline } from "./page";
import { validateFloat, validateInteger } from "./protocolValidation";

type MouseButton = "left" | "middle" | "right";
type Point = { x: number; y: number };

/** The Page action an input belongs to; the mouse API itself has no deadline. */
export type PointerInput = { deadline?: ActionDeadline; action: string };

/** What the pointer needs from the Page that owns the document. */
export type PointerHost = {
  readonly window: Window & typeof globalThis;
  modifiers(): readonly string[];
  /** The focused element, followed into open shadow roots; the body when none is. */
  deepActiveElement(): Element;
  assertDeadline(deadline: ActionDeadline | undefined, action: string): void;
  wait(
    durationMs: number | undefined,
    deadline: ActionDeadline | undefined,
    action: string
  ): Promise<void>;
};

/** `MouseEvent.button` for each button, and its bit in `MouseEvent.buttons`. */
const BUTTONS = {
  left: { code: 0, bit: 1 },
  middle: { code: 1, bit: 4 },
  right: { code: 2, bit: 2 },
} as const;

/** Refused once the mouse's page has closed; see `guardLifetimeCalls`. */
const MOUSE_LIFETIME_CALLS: Record<LifetimeCalls<BrowserMouse, Mouse>, true> = {
  click: true,
  dblclick: true,
  down: true,
  move: true,
  up: true,
  wheel: true,
};

/**
 * `page.mouse`: the pinned client `Mouse` members, their arguments checked
 * the way the pinned protocol does, over the Page's one `Pointer`. The
 * pointer stays private, so a consumer reaches only these six members.
 */
export class BrowserMouse implements Mouse {
  static {
    guardLifetimeCalls(
      BrowserMouse.prototype,
      MOUSE_LIFETIME_CALLS,
      "mouse",
      (mouse) => mouse.#lifetime
    );
  }

  readonly #pointer: Pointer;
  readonly #lifetime: PageLifetime;

  constructor(pointer: Pointer, lifetime: PageLifetime) {
    this.#pointer = pointer;
    this.#lifetime = lifetime;
  }

  async move(x: number, y: number, options: { steps?: number } = {}) {
    await api("mouse.move", async () => {
      const params = { ...options };
      const point = { x: validateFloat(x, "x"), y: validateFloat(y, "y") };
      const steps =
        params.steps === undefined ? 1 : validateInteger(params.steps, "steps");
      await this.#pointer.moveTo(point, { action: "mouse.move" }, steps);
    });
  }

  async down(
    options: { button?: MouseButton; clickCount?: number } = {}
  ): Promise<void> {
    await api("mouse.down", async () => {
      const { button, clickCount } = pressOptions(options);
      await this.#pointer.press(button, clickCount, { action: "mouse.down" });
    });
  }

  async up(
    options: { button?: MouseButton; clickCount?: number } = {}
  ): Promise<void> {
    await api("mouse.up", async () => {
      const { button, clickCount } = pressOptions(options);
      await this.#pointer.release(button, clickCount, { action: "mouse.up" });
    });
  }

  async click(
    x: number,
    y: number,
    options: { button?: MouseButton; clickCount?: number; delay?: number } = {}
  ): Promise<void> {
    await api("mouse.click", () => this.#clickAt("mouse.click", x, y, options));
  }

  async dblclick(
    x: number,
    y: number,
    options: { button?: MouseButton; delay?: number } = {}
  ): Promise<void> {
    // Pinned client input.ts: a click with clickCount 2, under its own name.
    await api("mouse.dblclick", () =>
      this.#clickAt("mouse.dblclick", x, y, { ...options, clickCount: 2 })
    );
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    await api("mouse.wheel", () =>
      this.#pointer.wheel(
        {
          x: validateFloat(deltaX, "deltaX"),
          y: validateFloat(deltaY, "deltaY"),
        },
        { action: "mouse.wheel" }
      )
    );
  }

  async #clickAt(
    action: string,
    x: number,
    y: number,
    options: { button?: MouseButton; clickCount?: number; delay?: number }
  ) {
    const params = { ...options };
    const point = { x: validateFloat(x, "x"), y: validateFloat(y, "y") };
    const delay =
      params.delay === undefined
        ? undefined
        : validateFloat(params.delay, "delay");
    const { button, clickCount } = pressOptions(params);
    const input = { action };
    await this.#pointer.moveTo(point, input);
    await this.#pointer.clickHere(button, clickCount, delay, input);
  }
}

/**
 * The one pointer of a Page: the analogue of pinned `server/input.ts` Mouse,
 * which `page.mouse` and the pointer actions (`click()`, `hover()` and their
 * relatives) share, plus the events Chromium derives from that raw input
 * (`server/chromium/crInput.ts`). Every event is script-dispatched in the
 * current document, one browser task each, like pinned `WebViewInput`.
 */
export class Pointer {
  /** Pinned input.ts Mouse starts at the document origin and tracks its moves. */
  private position: Point = { x: 0, y: 0 };
  /** The element under the pointer at the last boundary update. */
  private hovered: Element | undefined;
  /** The held buttons and the element each press hit; a drag starts from these. */
  private readonly pressed = new Map<MouseButton, Element>();
  /** Chromium keeps one click target: each press sets it and the first release consumes it. */
  private clickTarget: Element | undefined;
  /** A canceled `pointerdown` withholds `mousedown`, `mousemove` and `mouseup` until every button is up. */
  private mouseEventsWithheld = false;
  /** Pinned Mouse `_lastButton`: Chromium reports it as a move's `which`. */
  private lastButton: MouseButton | undefined;
  /** Where the last move event fired, for `movementX` and `movementY`. */
  private lastMove: Point | undefined;

  constructor(private readonly host: PointerHost) {}

  /** Pinned crInput.ts mouseWheel at the current position. */
  async wheel(delta: Point, input: PointerInput) {
    const point = this.position;
    await this.task(input, () => {
      // crInput.ts sends mouseWheel without a button or buttons mask.
      const target = this.hitTarget(point);
      const event = new this.host.window.WheelEvent("wheel", {
        ...this.eventInit("wheel", point, { button: -1, buttons: 0 }),
        deltaX: delta.x,
        deltaY: delta.y,
        deltaMode: 0,
      });
      // A constructed WheelEvent reports the deltas as its legacy
      // wheelDelta fields; the pinned Chromium reports one notch, 120,
      // against the direction of each delta.
      const notch = (value: number) => (value ? -Math.sign(value) * 120 : 0);
      Object.defineProperties(event, {
        wheelDeltaX: { value: notch(delta.x) },
        wheelDeltaY: { value: notch(delta.y) },
        wheelDelta: { value: notch(delta.y) || notch(delta.x) },
      });
      if (dispatch(target, event)) this.scrollForWheel(target, delta);
    });
    // After a scroll the browser updates the element under the pointer.
    await this.updateHover(point, input);
  }

  /**
   * Pinned Mouse.move: `steps` interpolated positions between the previous
   * position and `point`, the last landing exactly on it.
   */
  async moveTo(point: Point, input: PointerInput, steps = 1) {
    const from = this.position;
    this.position = point;
    for (let step = 1; step <= steps; step++)
      await this.moveStep(
        {
          x: from.x + (point.x - from.x) * (step / steps),
          y: from.y + (point.y - from.y) * (step / steps),
        },
        input
      );
  }

  /**
   * Pinned Mouse.click after its move: a press and release for each click
   * count, `delay` apart. `beforePress` lets a Page action stop when its
   * target is replaced between clicks.
   */
  async clickHere(
    button: MouseButton,
    clickCount: number,
    delay: number | undefined,
    input: PointerInput,
    beforePress?: () => void
  ) {
    for (let count = 1; count <= clickCount; count++) {
      beforePress?.();
      await this.press(button, count, input);
      await this.host.wait(delay, input.deadline, input.action);
      await this.release(button, count, input);
      if (count < clickCount)
        await this.host.wait(delay, input.deadline, input.action);
    }
  }

  private async moveStep(point: Point, input: PointerInput) {
    await this.updateHover(point, input);
    const buttons = this.buttonsMask();
    const movement = this.lastMove
      ? { x: point.x - this.lastMove.x, y: point.y - this.lastMove.y }
      : undefined;
    this.lastMove = point;
    await this.task(input, () =>
      this.fire(this.hitTarget(point), "pointermove", point, {
        button: -1,
        buttons,
        movement,
      })
    );
    if (!this.mouseEventsWithheld)
      await this.task(input, () =>
        this.fire(this.hitTarget(point), "mousemove", point, {
          button: this.lastButtonCode(),
          buttons,
          movement,
        })
      );
  }

  /**
   * crInput.ts mousePressed. The first button down is a `pointerdown`; a
   * further one is a chorded `pointermove`, while `mousedown` fires for each.
   * An allowed `mousedown` moves focus as the browser does.
   */
  async press(button: MouseButton, clickCount: number, input: PointerInput) {
    const point = this.position;
    const first = this.pressed.size === 0;
    this.pressed.set(button, this.hitTarget(point));
    this.lastButton = button;
    const fields = {
      button: BUTTONS[button].code,
      buttons: this.buttonsMask(),
    };
    // Like the release, boundary events the press brings carry its button.
    await this.updateHover(point, input, fields.button);
    const target = this.hitTarget(point);
    this.pressed.set(button, target);
    this.clickTarget = target;
    const pointerAllowed = await this.task(input, () =>
      this.fire(
        this.hitTarget(point),
        first ? "pointerdown" : "pointermove",
        point,
        fields
      )
    );
    if (first) this.mouseEventsWithheld = !pointerAllowed;
    if (!this.mouseEventsWithheld)
      await this.task(input, () => {
        const current = this.hitTarget(point);
        const allowed = this.fire(current, "mousedown", point, {
          ...fields,
          detail: clickCount,
        });
        this.host.assertDeadline(input.deadline, input.action);
        if (allowed) this.focusForPress(current);
      });
    if (button === "right")
      await this.task(input, () =>
        this.fire(this.hitTarget(point), "contextmenu", point, fields)
      );
  }

  /**
   * crInput.ts mouseReleased. The last button up is a `pointerup`, an
   * earlier one a chorded `pointermove`. The release that consumes the click
   * target fires `click` (`auxclick` for other buttons) on the nearest common
   * ancestor of the press and release targets, then `dblclick` for a second
   * left click.
   */
  async release(button: MouseButton, clickCount: number, input: PointerInput) {
    const point = this.position;
    this.pressed.delete(button);
    this.lastButton = undefined;
    const fields = {
      button: BUTTONS[button].code,
      buttons: this.buttonsMask(),
    };
    await this.updateHover(point, input, fields.button);
    const last = this.pressed.size === 0;
    // crInput.ts sends mouseReleased without force, so its pressure is 0.
    await this.task(input, () =>
      this.fire(
        this.hitTarget(point),
        last ? "pointerup" : "pointermove",
        point,
        { ...fields, pressure: 0 }
      )
    );
    const withheld = this.mouseEventsWithheld;
    if (last) this.mouseEventsWithheld = false;
    const pressTarget = this.clickTarget;
    this.clickTarget = undefined;
    if (!withheld)
      await this.task(input, () =>
        this.fire(this.hitTarget(point), "mouseup", point, {
          ...fields,
          detail: pressTarget ? clickCount : 0,
        })
      );
    if (!pressTarget || clickCount < 1) return;
    let clicked: Element | undefined;
    await this.task(input, () => {
      clicked = commonAncestor(pressTarget, this.hitTarget(point));
      if (clicked)
        this.fire(clicked, button === "left" ? "click" : "auxclick", point, {
          ...fields,
          detail: clickCount,
        });
    });
    if (clicked && button === "left" && clickCount === 2)
      await this.task(input, () =>
        this.fire(clicked!, "dblclick", point, {
          ...fields,
          detail: clickCount,
        })
      );
  }

  /**
   * Boundary events for a new element under the pointer, in Chromium's
   * order: `pointerout`, `pointerleave` from the innermost left element out,
   * `pointerover`, `pointerenter` from the outermost entered element in, then
   * the same four mouse events. The paths are flat-tree ancestors, from the
   * document down, so a shadow host is entered with its shadow content; after
   * the element under the pointer is removed, Chromium enters the whole path
   * again.
   *
   * Chromium updates the element under a still pointer on a timer after a
   * layout change; a press or release that finds a new element brings the
   * boundary events itself, and they carry its `button`.
   */
  private async updateHover(
    point: Point,
    input: PointerInput,
    changedButton?: number
  ) {
    const target = this.hitTarget(point);
    const previous = this.hovered;
    if (previous === target) return;
    const previousPath = previous?.isConnected ? flatTreePath(previous) : [];
    const path = flatTreePath(target);
    this.hovered = target;
    const left = previousPath.filter((node) => !path.includes(node)).reverse();
    const entered = path.filter((node) => !previousPath.includes(node));
    const buttons = this.buttonsMask();
    for (const kind of ["pointer", "mouse"] as const) {
      const button =
        changedButton ?? (kind === "pointer" ? -1 : this.lastButtonCode());
      const send = (node: Node, type: string, relatedTarget?: Element) =>
        this.task(input, () =>
          this.fire(node, `${kind}${type}`, point, {
            button,
            buttons,
            relatedTarget,
          })
        );
      if (previous?.isConnected) await send(previous, "out", target);
      for (const node of left) await send(node, "leave", target);
      await send(target, "over", previous);
      for (const node of entered) await send(node, "enter", previous);
    }
  }

  private lastButtonCode(): number {
    return this.lastButton ? BUTTONS[this.lastButton].code : -1;
  }

  private buttonsMask(): number {
    let mask = 0;
    for (const button of this.pressed.keys()) mask |= BUTTONS[button].bit;
    return mask;
  }

  /** `elementFromPoint()`, followed into open shadow roots. */
  private hitTarget(point: Point): Element {
    const document = this.host.window.document;
    let target =
      document.elementFromPoint(point.x, point.y) ?? document.documentElement;
    while (target.shadowRoot?.mode === "open") {
      const inner = target.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === target) break;
      target = inner;
    }
    return target;
  }

  /**
   * The browser's focus on press: the nearest mouse-focusable flat-tree
   * ancestor of the pressed element receives focus; with none, the focused
   * element blurs. Focusing never scrolls, as with a real press.
   */
  private focusForPress(element: Element) {
    const active = this.host.deepActiveElement();
    for (
      let node: Element | undefined = element;
      node;
      node = flatTreeParentElement(node)
    ) {
      if (node === active) return;
      if (!mouseFocusable(node)) continue;
      (node as HTMLElement).focus({ preventScroll: true });
      // Focus may land on a delegate; any change means this node took it.
      if (this.host.deepActiveElement() !== active) return;
    }
    if (active !== this.host.window.document.body)
      (active as HTMLElement).blur?.();
  }

  /**
   * The wheel's default action: the nearest ancestor that can scroll in the
   * delta's direction, or else the viewport, scrolls by the deltas at once.
   */
  private scrollForWheel(target: Element, delta: Point) {
    const { window } = this.host;
    const { document } = window;
    for (
      let element: Element | undefined = target;
      element;
      element = flatTreeParentElement(element)
    ) {
      if (element === document.documentElement || element === document.body)
        continue;
      const style = window.getComputedStyle(element);
      if (
        canScroll(
          style.overflowX,
          element.scrollLeft,
          element.clientWidth,
          element.scrollWidth,
          delta.x
        ) ||
        canScroll(
          style.overflowY,
          element.scrollTop,
          element.clientHeight,
          element.scrollHeight,
          delta.y
        )
      ) {
        element.scrollBy({ left: delta.x, top: delta.y, behavior: "instant" });
        return;
      }
    }
    // The viewport takes the root's overflow, or the body's when the root's is visible.
    const root = window.getComputedStyle(document.documentElement);
    const viewport =
      root.overflowX === "visible" &&
      root.overflowY === "visible" &&
      document.body
        ? window.getComputedStyle(document.body)
        : root;
    // The viewport scrolls unless its overflow is hidden or clipped.
    const blocked = (overflow: string) =>
      overflow === "hidden" || overflow === "clip";
    window.scrollBy({
      left: blocked(viewport.overflowX) ? 0 : delta.x,
      top: blocked(viewport.overflowY) ? 0 : delta.y,
      behavior: "instant",
    });
  }

  private task<T>(input: PointerInput, run: () => T): Promise<T> {
    // Like pinned WebViewInput._postTask, each event is a browser task. The
    // deadline is checked inside the task, so expiry cannot fire input later.
    return new Promise<T>((resolve, reject) =>
      this.host.window.setTimeout(() => {
        try {
          this.host.assertDeadline(input.deadline, input.action);
          resolve(run());
        } catch (error) {
          reject(error);
        }
      })
    );
  }

  /**
   * One event as Chromium builds it: pointer events for the pointer, with
   * `click`, `auxclick` and `contextmenu` also PointerEvents but not primary,
   * and MouseEvents for the rest.
   */
  private fire(
    target: Node,
    type: string,
    point: Point,
    fields: EventFields
  ): boolean {
    // Chromium never dispatches these to a disabled form control or its
    // content; the press still moves focus.
    if (CLICK_EVENTS.has(type) && insideDisabledControl(target)) return true;
    const { PointerEvent, MouseEvent } = this.host.window;
    const init = this.eventInit(type, point, fields);
    const pointer = { pointerId: 1, pointerType: "mouse" };
    return dispatch(
      target,
      type.startsWith("pointer")
        ? new PointerEvent(type, {
            ...init,
            ...pointer,
            isPrimary: true,
            pressure: fields.pressure ?? (fields.buttons ? 0.5 : 0),
          })
        : type === "click" || type === "auxclick" || type === "contextmenu"
          ? new PointerEvent(type, { ...init, ...pointer })
          : new MouseEvent(type, init)
    );
  }

  private eventInit(
    type: string,
    point: Point,
    fields: EventFields
  ): MouseEventInit {
    // Enter and leave events neither bubble nor cancel nor cross shadow roots.
    const flows = !/(enter|leave)$/.test(type);
    const modifiers = this.host.modifiers();
    return {
      bubbles: flows,
      cancelable: flows,
      composed: flows,
      button: fields.button,
      buttons: fields.buttons,
      detail: fields.detail ?? 0,
      // Chromium keeps input coordinates in single precision.
      clientX: Math.fround(point.x),
      clientY: Math.fround(point.y),
      // Like pinned WebViewInput, screen coordinates are the client ones.
      screenX: Math.fround(point.x),
      screenY: Math.fround(point.y),
      movementX: fields.movement?.x ?? 0,
      movementY: fields.movement?.y ?? 0,
      view: this.host.window,
      relatedTarget: fields.relatedTarget ?? null,
      altKey: modifiers.includes("Alt"),
      ctrlKey: modifiers.includes("Control"),
      metaKey: modifiers.includes("Meta"),
      shiftKey: modifiers.includes("Shift"),
    };
  }
}

/**
 * `button` is -1 when no button changed; MouseEvents then report 0 and a
 * `which` of 0, as Chromium's own moves do.
 */
type EventFields = {
  button: number;
  buttons: number;
  detail?: number;
  relatedTarget?: Element;
  movement?: Point;
  pressure?: number;
};

const CLICK_EVENTS = new Set(["mousedown", "mouseup", "click", "dblclick"]);
const FORM_CONTROLS = new Set([
  "button",
  "fieldset",
  "input",
  "select",
  "textarea",
]);

function insideDisabledControl(node: Node): boolean {
  for (
    let element = node.nodeType === 1 ? (node as Element) : undefined;
    element;
    element = flatTreeParentElement(element)
  )
    if (FORM_CONTROLS.has(element.localName) && element.matches(":disabled"))
      return true;
  return false;
}

/** Marks the event for the pinned hit-target interceptor, as WebViewInput does. */
function dispatch(target: Node, event: Event): boolean {
  Object.defineProperty(event, "__pwTrustedSynthetic", { value: true });
  return target.dispatchEvent(event);
}

async function api(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) error.message = `${name}: ${error.message}`;
    throw error;
  }
}

function pressOptions(options: { button?: unknown; clickCount?: unknown }): {
  button: MouseButton;
  clickCount: number;
} {
  const { button = "left", clickCount = 1 } = options;
  if (typeof button !== "string" || !Object.hasOwn(BUTTONS, button))
    throw new Error("button: expected one of (left|right|middle)");
  return {
    button: button as MouseButton,
    clickCount: validateInteger(clickCount, "clickCount"),
  };
}

function userScrollable(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function canScroll(
  overflow: string,
  offset: number,
  size: number,
  extent: number,
  delta: number
): boolean {
  if (!delta || !userScrollable(overflow)) return false;
  return delta > 0 ? offset + size < extent : offset > 0;
}

/** The parent in the flat tree: a slotted node's slot, a shadow root's host. */
function flatTreeParent(node: Node): Node | undefined {
  const slot = (node as Element | Text).assignedSlot;
  if (slot) return slot;
  const parent = node.parentNode;
  if (!parent) return undefined;
  // Node types, not constructors: a page may delete its own globals.
  return parent.nodeType === 11 && (parent as ShadowRoot).host
    ? (parent as ShadowRoot).host
    : parent;
}

function flatTreeParentElement(node: Node): Element | undefined {
  const parent = flatTreeParent(node);
  return parent?.nodeType === 1 ? (parent as Element) : undefined;
}

/** `node` and its flat-tree ancestors, from the document down. */
function flatTreePath(node: Node): Node[] {
  const path: Node[] = [];
  for (
    let current: Node | undefined = node;
    current;
    current = flatTreeParent(current)
  )
    path.unshift(current);
  return path;
}

/** The nearest connected flat-tree ancestor both elements share. */
function commonAncestor(a: Element, b: Element): Element | undefined {
  if (!a.isConnected) return undefined;
  const path = flatTreePath(b);
  for (
    let node: Element | undefined = a;
    node;
    node = flatTreeParentElement(node)
  )
    if (path.includes(node)) return node;
  return undefined;
}

/**
 * Whether a press can focus the element, as Chromium's mouse focusability:
 * elements focusable by default or by `tabindex`, editing hosts and shadow
 * hosts that delegate focus. Elements `focus()` accepts only as keyboard
 * stops, such as scroll containers, are skipped, and so are labels and
 * legends, whose `focus()` moves focus to their control; a label's click
 * activation focuses the control instead.
 */
function mouseFocusable(element: Element): boolean {
  const html = element as HTMLElement;
  if (typeof html.focus !== "function") return false;
  if (element.hasAttribute("tabindex")) return true;
  if (element.localName === "label" || element.localName === "legend")
    return false;
  return (
    html.tabIndex >= 0 ||
    html.isContentEditable ||
    !!element.shadowRoot?.delegatesFocus
  );
}
