import { Element } from "virtual:playwright-lite-globals";

import {
  HostObservation,
  perWindow,
  type HostFunction,
  type HostMember,
} from "./hostGlobals";

/**
 * A `setPointerCapture`, `releasePointerCapture` or `hasPointerCapture` call
 * on one of this package's pointer ids, handed to every subscribed pointer:
 * the one that owns the id records it, and sets `owned`, and `captured`
 * answers `hasPointerCapture`.
 */
export type CaptureCall = {
  readonly method: "own" | "set" | "release" | "has";
  readonly element: Element;
  readonly pointerId: number;
  owned: boolean;
  captured: boolean;
};

export type CaptureReport = (call: CaptureCall) => void;

/** The one capture observation of a window, shared by every `Page` created for it. */
export const pointerCaptureObservationFor = perWindow(
  (browserWindow) => new PointerCaptureObservation(browserWindow)
);

/**
 * Explicit pointer capture for the synthetic pointers. The browser keeps
 * capture only for pointers it knows: it ignores `setPointerCapture()` for
 * the mouse while no real button is held, and rejects a touch pointer id
 * nothing touches with a `NotFoundError`. While a pointer is subscribed, the
 * three `Element` members are wrapped: each call runs the browser's own first,
 * so a wrong receiver, a missing argument and an unknown pointer id fail as
 * they do natively, and is then recorded for the pointer that owns the id.
 */
export class PointerCaptureObservation {
  private readonly host: HostObservation<CaptureReport>;

  constructor(private readonly window: Window & typeof globalThis) {
    const holder = Element.prototype as unknown as Record<string, unknown>;
    const member = (
      name: string,
      method: "set" | "release" | "has"
    ): HostMember => ({
      holder,
      name,
      intercept: (original: HostFunction, thisArg, args) =>
        this.observe(method, original, thisArg, args),
    });
    this.host = new HostObservation([
      member("setPointerCapture", "set"),
      member("releasePointerCapture", "release"),
      member("hasPointerCapture", "has"),
    ]);
  }

  /** Reports to `report` until the returned release is called. */
  subscribe(report: CaptureReport): () => void {
    return this.host.subscribe(report);
  }

  private observe(
    method: "set" | "release" | "has",
    original: HostFunction,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    // The id is converted once, as WebIDL `long`, and the browser gets the
    // converted value; a value that cannot convert, or a missing one, reaches
    // the browser as given, which rejects it.
    let pointerId: number | undefined;
    if (args.length > 0)
      try {
        pointerId = (args[0] as number) | 0;
      } catch {
        // The browser throws its own error for it below.
      }
    const forwarded =
      pointerId === undefined ? args : [pointerId, ...args.slice(1)];
    let result: unknown;
    try {
      result = Reflect.apply(original, thisArg, forwarded);
    } catch (error) {
      // Only an id the browser does not know, which a synthetic touch point
      // is, goes on to the pointer that owns it; the browser has already
      // checked the receiver and converted the id by then.
      if ((error as { name?: unknown } | null)?.name !== "NotFoundError")
        throw error;
      const element = thisArg as Element;
      if (!this.report("own", element, pointerId!).owned) throw error;
      if (method === "set" && !element.isConnected)
        throw new this.window.DOMException(
          "Failed to execute 'setPointerCapture' on 'Element': InvalidStateError",
          "InvalidStateError"
        );
    }
    const call = this.report(method, thisArg as Element, pointerId!);
    return method === "has" ? result === true || call.captured : result;
  }

  private report(
    method: CaptureCall["method"],
    element: Element,
    pointerId: number
  ): CaptureCall {
    const call: CaptureCall = {
      method,
      element,
      pointerId,
      owned: false,
      captured: false,
    };
    this.host.report(call);
    return call;
  }
}

/**
 * One pointer's capture targets, as Chromium's `PointerEventManager` keeps
 * them: `pending` is what `setPointerCapture()` and `releasePointerCapture()`
 * change and `hasPointerCapture()` reads, and `current` takes its value before
 * the pointer's next event.
 */
export class PointerCapture {
  pending: Element | undefined;
  current: Element | undefined;

  constructor(
    readonly pointerId: number,
    /** Whether the pointer is in the active buttons state, which capture needs. */
    private readonly active: () => boolean
  ) {}

  /** Records `call` when it is for this pointer. */
  record(call: CaptureCall) {
    if (call.pointerId !== this.pointerId) return;
    call.owned = true;
    if (call.method === "set") {
      if (this.active()) this.pending = call.element;
    } else if (call.method === "release") {
      if (this.pending === call.element) this.pending = undefined;
    } else if (call.method === "has")
      call.captured ||=
        this.pending === call.element && call.element.isConnected;
  }

  /**
   * The pending target for the pointer's next event. Chromium clears it when
   * the element leaves the document; that is noticed here, so an element
   * added back before then keeps it.
   */
  takePending(): Element | undefined {
    if (this.pending && !this.pending.isConnected) this.pending = undefined;
    return this.pending;
  }

  /** Forgets both targets without firing anything. */
  clear() {
    this.pending = this.current = undefined;
  }

  get idle(): boolean {
    return !this.pending && !this.current;
  }
}
