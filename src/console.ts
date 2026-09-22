import { WrappedHostFunction } from "./hostGlobals";
import { previewValue, type AdapterJSHandle } from "./jsHandle";
import type { JSHandle, Page } from "@playwright/test";

/**
 * The document's `console.*` calls, reported with Playwright's `ConsoleMessage`
 * shape.
 *
 * A browser-generated console entry (a failed resource load, a CSP violation
 * report) never calls a `console.*` method, so this observation never sees it;
 * see the `consoleMessages`/`clearConsoleMessages` ledger notes.
 */

export type ConsoleMessageType =
  | "log"
  | "debug"
  | "info"
  | "error"
  | "warning"
  | "dir"
  | "dirxml"
  | "table"
  | "trace"
  | "clear"
  | "startGroup"
  | "startGroupCollapsed"
  | "endGroup"
  | "assert"
  | "profile"
  | "profileEnd"
  | "count"
  | "timeEnd";

export type ConsoleMessageLocation = {
  url: string;
  lineNumber: number;
  columnNumber: number;
};

/** Pinned client/events.ts Page event this observation emits. */
export const CONSOLE_EVENT = "console";

/**
 * Pinned client/consoleMessage.ts `ConsoleMessage`. `worker()` is always
 * `null`: this observation has no worker realm to report. `args()` is typed
 * with Playwright's own `JSHandle`, the way `createPage`'s `Page` types every
 * other adapter handle it returns, keeping this package's own internal
 * handle implementation out of this public interface's surface.
 */
export interface ConsoleMessage {
  args(): JSHandle[];
  location(): {
    url: string;
    line: number;
    column: number;
    lineNumber: number;
    columnNumber: number;
  };
  page(): Page | null;
  text(): string;
  timestamp(): number;
  type(): ConsoleMessageType;
  worker(): null;
}

/**
 * Built per subscribing `Page`, not inside `ConsoleObservation`: `args()` must
 * hold this package's own `JSHandle`s, which only the owning page's
 * `Evaluation` can create, and `page()` must return that same page.
 */
export class ObservedConsoleMessage implements ConsoleMessage {
  constructor(
    private readonly _page: Page,
    private readonly _type: ConsoleMessageType,
    private readonly _args: AdapterJSHandle[],
    private readonly _text: string,
    private readonly _location: ConsoleMessageLocation,
    private readonly _timestamp: number
  ) {}

  args(): JSHandle[] {
    return this._args as unknown as JSHandle[];
  }

  location() {
    const { url, lineNumber, columnNumber } = this._location;
    return {
      url,
      line: lineNumber,
      column: columnNumber,
      lineNumber,
      columnNumber,
    };
  }

  page() {
    return this._page;
  }

  text() {
    return this._text;
  }

  timestamp() {
    return this._timestamp;
  }

  type() {
    return this._type;
  }

  worker() {
    return null;
  }
}

/**
 * Pinned server/chromium/crPage.ts `_onConsoleAPI`: the native `console.*`
 * method name each pinned `ConsoleMessage.type()` value comes from. `time` is
 * never wrapped: the browser's own `Runtime.consoleAPICalled` never fires for
 * it, only for `timeLog` and the paired `timeEnd`. `timeLog` reports as type
 * `log`, verified against real Chromium; the pinned public `type()` union has
 * no separate `timeLog` value.
 */
const CONSOLE_METHOD_TYPES: Readonly<Record<string, ConsoleMessageType>> = {
  log: "log",
  debug: "debug",
  info: "info",
  error: "error",
  warn: "warning",
  dir: "dir",
  dirxml: "dirxml",
  table: "table",
  trace: "trace",
  clear: "clear",
  group: "startGroup",
  groupCollapsed: "startGroupCollapsed",
  groupEnd: "endGroup",
  assert: "assert",
  profile: "profile",
  profileEnd: "profileEnd",
  count: "count",
  timeEnd: "timeEnd",
  timeLog: "log",
};

/**
 * Verified against real Chromium, not documented in the pinned TypeScript
 * source (the CDP protocol formats console text in the browser process,
 * which the pinned client only receives already formatted): `group()`,
 * `groupCollapsed()`, `groupEnd()`, `clear()` and `trace()` always report,
 * falling back to `console.<method>` when called with no message argument
 * (`groupEnd()`/`clear()` take none at all, so this is their only text).
 * `assert`'s own fallback is handled in `observe`, after its condition
 * argument is dropped, but uses this same "console.<method>" text.
 */
const FALLBACK_TEXT_METHODS = new Set([
  "group",
  "groupCollapsed",
  "groupEnd",
  "clear",
  "trace",
  "assert",
]);

/**
 * Verified against real Chromium: a bare call (no arguments) to any of these
 * is never reported at all, unlike the `FALLBACK_TEXT_METHODS` above.
 */
const SUPPRESSED_WHEN_EMPTY = new Set([
  "log",
  "debug",
  "info",
  "error",
  "warn",
  "dir",
  "dirxml",
  "table",
]);

/** Pinned server/page.ts `addConsoleMessage`/`consoleMessages` recent bound. */
export const CONSOLE_MESSAGE_LIMIT = 200;

export type ConsoleCall = {
  type: ConsoleMessageType;
  /** The raw arguments the Site passed, wrapped into `JSHandle`s per page. */
  args: unknown[];
  /** Pinned client/console.ts: joins each argument's object-preview text. */
  text: string;
  location: ConsoleMessageLocation;
  timestamp: number;
};

type Emit = (call: ConsoleCall) => void;
type NativeConsoleMethod = (...args: unknown[]) => unknown;

/**
 * Frames this module's own call chain adds, above the captured stack, before
 * the Site's own call site: `captureLocation` itself, `observe`, the
 * `WrappedHostFunction` interceptor callback, and the `Proxy` `apply` trap. A
 * bundled `dist/index.mjs` has no `console.ts`/`hostGlobals.ts` frame a
 * file-path marker could match — verified against the built bundle, where
 * that approach always named this module's own frame — so this call chain's
 * fixed depth is skipped instead, which bundling cannot change.
 */
const INTERNAL_FRAME_COUNT = 4;

const STACK_FRAME = /\(?([^()\s]+):(\d+):(\d+)\)?$/;

/**
 * Pinned server/chromium/crProtocolHelper.ts `stackTraceToLocation`: the
 * console call's own frame, not the interceptor's. No CDP stack trace is
 * available inside the document, so this is reconstructed from a captured
 * `Error` stack and named best-effort in the ledger: unlike the pinned
 * CDP-sourced location, engine stack-formatting differences and inlining can
 * shift or drop a frame.
 */
function captureLocation(): ConsoleMessageLocation {
  const stack = new Error().stack;
  if (!stack) return { url: "", lineNumber: 0, columnNumber: 0 };
  for (const line of stack.split("\n").slice(1 + INTERNAL_FRAME_COUNT)) {
    const match = STACK_FRAME.exec(line.trim());
    if (!match) continue;
    const lineNumber = Number(match[2]) - 1;
    const columnNumber = Number(match[3]) - 1;
    if (Number.isNaN(lineNumber) || Number.isNaN(columnNumber)) continue;
    return { url: match[1], lineNumber, columnNumber };
  }
  return { url: "", lineNumber: 0, columnNumber: 0 };
}

/**
 * A shallow, best-effort stand-in for the pinned CDP object-preview
 * algorithm: a string renders bare; a plain object or array lists its own
 * entries one level deep, each through `previewValue`; anything else is
 * `previewValue` itself. This follows this package's own `JSHandle`
 * description, not V8's preview (no truncation, no sparse-array markers, no
 * class-instance member listing).
 */
function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(previewValue).join(", ")}]`;
  if (
    value !== null &&
    typeof value === "object" &&
    Object.prototype.toString.call(value).slice(8, -1) === "Object"
  )
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${previewValue(item)}`)
      .join(", ")}}`;
  return previewValue(value);
}

/** Pinned client/consoleMessage.ts `text()`: argument previews joined by a space. */
function formatConsoleText(args: readonly unknown[]): string {
  return args.map(formatConsoleArg).join(" ");
}

const observations = new WeakMap<Window, ConsoleObservation>();

/** The one observation of a window's `console`, shared by every `Page` of it. */
export function consoleObservationFor(
  browserWindow: Window & typeof globalThis
): ConsoleObservation {
  let observation = observations.get(browserWindow);
  if (!observation)
    observations.set(
      browserWindow,
      (observation = new ConsoleObservation(browserWindow))
    );
  return observation;
}

/**
 * Reports the document's `console.*` calls as Playwright's `console` event,
 * for as long as something is subscribed. Each wrapped method is its own
 * `WrappedHostFunction`, installed and restored together as one subscription.
 */
export class ConsoleObservation {
  private readonly wrappers: WrappedHostFunction<NativeConsoleMethod>[] = [];
  private readonly subscribers = new Set<Emit>();

  constructor(private readonly window: Window & typeof globalThis) {
    const consoleObject = window.console as unknown as Record<string, unknown>;
    for (const [method, type] of Object.entries(CONSOLE_METHOD_TYPES)) {
      if (typeof consoleObject[method] !== "function") continue;
      this.wrappers.push(
        new WrappedHostFunction<NativeConsoleMethod>(
          consoleObject,
          method,
          (original, thisArg, args) =>
            this.observe(type, method, original, thisArg, args)
        )
      );
    }
  }

  /** Reports to `emit` until the returned release is called. */
  subscribe(emit: Emit): () => void {
    this.subscribers.add(emit);
    const releases = this.wrappers.map((wrapper) => wrapper.subscribe());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subscribers.delete(emit);
      for (const release of releases) release();
    };
  }

  private emit(call: ConsoleCall) {
    for (const subscriber of [...this.subscribers]) subscriber(call);
  }

  /** Guards one `emit` call against the reentrancy `observe` documents. */
  private emitting = false;

  /**
   * Pinned `console.assert`: reports only when the asserted condition is
   * falsy, and drops the condition from the reported arguments. Every
   * synthesized-fallback and bare-call-suppression rule is verified against
   * real Chromium; see `FALLBACK_TEXT_METHODS`/`SUPPRESSED_WHEN_EMPTY`.
   *
   * A subscriber runs inside this document, unlike the pinned client's
   * Node-side listener, so one that itself calls a wrapped method (including
   * indirectly, through this observation's own listener-failure logging)
   * would otherwise re-enter this method without end; `emitting` guards one
   * `emit` call against that, forwarding to the original method regardless.
   */
  private observe(
    type: ConsoleMessageType,
    method: string,
    original: NativeConsoleMethod,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    const result = Reflect.apply(original, thisArg, args);
    if (method === "assert") {
      if (args[0]) return result;
      args = args.slice(1);
    }
    if (args.length === 0 && SUPPRESSED_WHEN_EMPTY.has(method)) return result;
    if (this.emitting) return result;
    const text =
      args.length === 0 && FALLBACK_TEXT_METHODS.has(method)
        ? `console.${method}`
        : formatConsoleText(args);
    this.emitting = true;
    try {
      this.emit({ type, args, text, location: captureLocation(), timestamp: Date.now() });
    } finally {
      this.emitting = false;
    }
    return result;
  }
}
