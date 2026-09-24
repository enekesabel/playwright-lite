import type { Page } from "@playwright/test";
import { HostObservation, perWindow } from "./hostGlobals";
import { validateString } from "./protocolValidation";

/** `beforeunload` is out of scope: it belongs to document replacement (ADR-0001). */
type DialogType = "alert" | "confirm" | "prompt";

type Settlement = { accepted: boolean; value?: string };
type SettlementBox = { result?: Settlement };

/** One `alert`/`confirm`/`prompt` call, built per subscribed page around a settlement its siblings share. */
export class Dialog {
  constructor(
    private readonly _type: DialogType,
    private readonly _message: string,
    private readonly _defaultValue: string,
    private readonly box: SettlementBox,
    private readonly _page: () => Page
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

  page(): Page {
    return this._page();
  }

  async accept(promptText?: string): Promise<void> {
    if (promptText !== undefined) {
      try {
        promptText = validateString(promptText, "promptText");
      } catch (error) {
        throw new TypeError(`dialog.accept: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    this.settle(true, promptText);
  }

  async dismiss(): Promise<void> {
    this.settle(false, undefined);
  }

  private settle(accepted: boolean, value: string | undefined): void {
    if (this.box.result !== undefined)
      throw new Error(
        `dialog.${accepted ? "accept" : "dismiss"}: Cannot ${accepted ? "accept" : "dismiss"} dialog which is already handled!`
      );
    this.box.result = { accepted, value };
  }
}

export type DialogReport = (
  type: DialogType,
  message: string,
  defaultValue: string,
  box: SettlementBox
) => void;

/** A `message`/`default` argument, coerced the way the platform coerces it: omitted becomes `""`, a `Symbol` throws. */
function stringArg(value: unknown): string {
  return value === undefined ? "" : `${value as string}`;
}

/** `undefined` for `alert`, the accepted boolean for `confirm`, the accepted string (or `null`) for `prompt`. */
function nativeReturnValue(
  type: DialogType,
  defaultValue: string,
  result: Settlement
): undefined | boolean | string | null {
  if (type === "alert") return undefined;
  if (type === "confirm") return result.accepted;
  if (!result.accepted) return null;
  return result.value ?? defaultValue;
}

/** The one observation of a window's dialogs, shared by every `Page` created for it (see `networkObservationFor`). */
export const dialogObservationFor = perWindow(
  (browserWindow) => new DialogObservation(browserWindow)
);

type NativeDialogFn = (...args: unknown[]) => unknown;
const DIALOG_HOST_MEMBERS = ["alert", "confirm", "prompt"] as const;

/** Reports `window.alert`/`confirm`/`prompt` as Playwright's `dialog` event for as long as something is subscribed. */
export class DialogObservation {
  private readonly host: HostObservation<DialogReport>;

  constructor(private readonly window: Window & typeof globalThis) {
    const holder = window as unknown as Record<string, unknown>;
    this.host = new HostObservation(
      DIALOG_HOST_MEMBERS.map((type) => ({
        holder,
        name: type,
        intercept: (original: NativeDialogFn, thisArg, args) =>
          this.observe(type, original, thisArg, args),
      }))
    );
  }

  /** Reports to `report` until the returned release is called. */
  subscribe(report: DialogReport): () => void {
    return this.host.subscribe(report);
  }

  private observe(
    type: DialogType,
    original: NativeDialogFn,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    // A receiver the platform rejects still throws here, before a dialog is
    // ever reported, the same as the network wrapper lets a bad fetch receiver throw.
    if (thisArg !== undefined && thisArg !== null && thisArg !== this.window)
      return Reflect.apply(original, thisArg, args);
    const message = stringArg(args[0]);
    const defaultValue = type === "prompt" ? stringArg(args[1]) : "";
    const box: SettlementBox = {};
    // Synchronous dispatch: a listener calling accept()/dismiss() while this
    // runs settles the dialog before the auto-dismiss below ever applies.
    this.host.report(type, message, defaultValue, box);
    box.result ??= { accepted: false };
    return nativeReturnValue(type, defaultValue, box.result);
  }
}
