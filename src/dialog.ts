import { WrappedHostFunction } from "./hostGlobals";

/**
 * The `alert`, `confirm` and `prompt` calls the controlled document makes,
 * reported with Playwright's `Dialog` surface.
 *
 * `beforeunload` dialogs are out of scope: they belong to document
 * replacement, a boundary this package does not cross (see ADR-0001).
 */
export type DialogType = "alert" | "confirm" | "prompt";

/** The pinned `client/dialog.ts` members this observation can fill. */
export interface Dialog {
  type(): DialogType;
  message(): string;
  defaultValue(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

type NativeAlert = typeof globalThis.alert;
type NativeConfirm = typeof globalThis.confirm;
type NativePrompt = typeof globalThis.prompt;

type Settlement = { accepted: boolean; value: string | undefined };

/**
 * Pinned `server/dialog.ts` `assert(!this._handled, …)`: settling an
 * already-settled dialog rejects with the same message, whether the second
 * settlement arrives synchronously or later.
 */
function alreadyHandled(accepted: boolean): Error {
  return new Error(
    `Cannot ${accepted ? "accept" : "dismiss"} dialog which is already handled!`
  );
}

/**
 * One `alert`/`confirm`/`prompt` call. `alert` and `confirm` are synchronous
 * from the document's perspective, so whichever `accept`/`dismiss` call
 * settles this object first — synchronously, while `dialog` listeners are
 * still being called — decides the value the wrapped call returns to the
 * document. `accept`/`dismiss` are declared `async` to match the pinned
 * client, but neither awaits anything: the settlement itself happens
 * synchronously in the body, before the returned promise is even observed.
 */
export class DialogState implements Dialog {
  private handled = false;
  private settlement: Settlement | undefined;

  constructor(
    private readonly _type: DialogType,
    private readonly _message: string,
    private readonly _defaultValue: string
  ) {}

  type(): DialogType {
    return this._type;
  }

  message(): string {
    return this._message;
  }

  defaultValue(): string {
    return this._defaultValue;
  }

  async accept(promptText?: string): Promise<void> {
    this.settle(true, promptText);
  }

  async dismiss(): Promise<void> {
    this.settle(false, undefined);
  }

  private settle(accepted: boolean, value: string | undefined): void {
    if (this.handled) throw alreadyHandled(accepted);
    this.handled = true;
    this.settlement = { accepted, value };
  }

  /**
   * Pinned auto-dismiss: called once dispatch to every listener has
   * returned. A no-op once something already settled the dialog.
   */
  settleIfUnhandled(): void {
    if (!this.handled) {
      this.handled = true;
      this.settlement = { accepted: false, value: undefined };
    }
  }

  /**
   * The value the wrapped `alert`/`confirm`/`prompt` call returns to the
   * document: `undefined` for `alert`, `true`/`false` for `confirm`, the
   * string or `null` for `prompt`. Accepting a prompt without a value keeps
   * its default, the way leaving a real prompt's input untouched does.
   */
  nativeReturnValue(): undefined | boolean | string | null {
    const settlement = this.settlement!;
    if (this._type === "alert") return undefined;
    if (this._type === "confirm") return settlement.accepted;
    if (!settlement.accepted) return null;
    return settlement.value ?? this._defaultValue;
  }
}

type Emit = (state: DialogState) => void;

/** A `message`/`default` argument, coerced the way the platform coerces it: omitted or `undefined` becomes `""`, anything else becomes a string. */
function stringArg(value: unknown): string {
  return value === undefined ? "" : String(value);
}

const observations = new WeakMap<Window, DialogObservation>();

/**
 * The one observation of a window's `alert`/`confirm`/`prompt`. Every `Page`
 * created for the same window shares it, for the reason `networkObservationFor`
 * shares `NetworkObservation`: a second wrapper would wrap the first one's
 * proxy, and unsubscribing in installation order would then leave that proxy
 * behind for good.
 */
export function dialogObservationFor(
  browserWindow: Window & typeof globalThis
): DialogObservation {
  let observation = observations.get(browserWindow);
  if (!observation)
    observations.set(
      browserWindow,
      (observation = new DialogObservation(browserWindow))
    );
  return observation;
}

/**
 * Reports the window's `alert`/`confirm`/`prompt` calls as Playwright's
 * `dialog` event, for as long as something is subscribed.
 *
 * The host functions are wrapped only while subscribed, and restored on the
 * last unsubscribe under the same last-resort rule as the network wrapper
 * (`WrappedHostFunction`). With no listener ever registered, or after the
 * last one is removed, the document's dialogs are native and untouched: this
 * package never opens a real dialog, so a Site relying on the browser's own
 * modal (a manual test, a native dismiss button) keeps working exactly as it
 * would without this package involved.
 *
 * While subscribed, the wrapped call never reaches the real
 * `alert`/`confirm`/`prompt`: a real dialog blocks the document's main
 * thread with no way for in-page script to dismiss it, so the wrapper
 * computes the result itself instead of forwarding the call.
 */
export class DialogObservation {
  private readonly alertWrapper: WrappedHostFunction<NativeAlert>;
  private readonly confirmWrapper: WrappedHostFunction<NativeConfirm>;
  private readonly promptWrapper: WrappedHostFunction<NativePrompt>;
  private readonly subscribers = new Map<Emit, number>();

  constructor(private readonly window: Window & typeof globalThis) {
    const holder = window as unknown as Record<string, unknown>;
    this.alertWrapper = new WrappedHostFunction(holder, "alert", (_o, _t, args) =>
      this.observe("alert", args)
    );
    this.confirmWrapper = new WrappedHostFunction(
      holder,
      "confirm",
      (_o, _t, args) => this.observe("confirm", args)
    );
    this.promptWrapper = new WrappedHostFunction(
      holder,
      "prompt",
      (_o, _t, args) => this.observe("prompt", args)
    );
  }

  /** Reports to `emit` until the returned release is called. */
  subscribe(emit: Emit): () => void {
    this.subscribers.set(emit, (this.subscribers.get(emit) ?? 0) + 1);
    const releases = [
      this.alertWrapper.subscribe(),
      this.confirmWrapper.subscribe(),
      this.promptWrapper.subscribe(),
    ];
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = (this.subscribers.get(emit) ?? 1) - 1;
      if (held > 0) this.subscribers.set(emit, held);
      else this.subscribers.delete(emit);
      for (const release of releases) release();
    };
  }

  private observe(type: DialogType, args: unknown[]): unknown {
    const message = stringArg(args[0]);
    const defaultValue = type === "prompt" ? stringArg(args[1]) : "";
    const state = new DialogState(type, message, defaultValue);
    // Synchronous dispatch: a listener calling accept()/dismiss() while this
    // runs settles the dialog before the auto-dismiss below ever applies.
    for (const subscriber of [...this.subscribers.keys()]) subscriber(state);
    state.settleIfUnhandled();
    return state.nativeReturnValue();
  }
}
