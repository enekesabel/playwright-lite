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
 * method name each pinned `ConsoleMessage.type()` value comes from. `time` and
 * `timeLog` are not wrapped: the browser's own `Runtime.consoleAPICalled`
 * never fires for them either, only for the paired `timeEnd`.
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
};

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
 * Frame markers this module's own call chain adds between the `console.*`
 * call site and the captured stack: the wrapper's `apply` trap, this
 * observation's interceptor, and the frame that reads the stack itself.
 * Skipped so the best-effort location names the Site's call site, not ours.
 */
const INTERNAL_FRAME_MARKERS = ["/hostGlobals.ts", "/console.ts"];

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
  for (const line of stack.split("\n").slice(1)) {
    if (INTERNAL_FRAME_MARKERS.some((marker) => line.includes(marker)))
      continue;
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
 * Pinned server/chromium/crExecutionContext.ts `renderPreview`, applied to an
 * argument still living in the document rather than a CDP remote object: a
 * string renders bare, a plain object or array lists its own enumerable
 * entries one level deep, and anything else falls back to the same shallow
 * description `JSHandle.toString()` uses.
 */
function formatConsoleArg(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return previewValue(value);
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Date" || tag === "RegExp" || tag === "Error")
    return previewValue(value);
  const nested = (item: unknown) =>
    typeof item === "object" && item !== null
      ? previewValue(item)
      : formatConsoleArg(item);
  if (Array.isArray(value)) return `[${value.map(nested).join(", ")}]`;
  if (tag === "Object")
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${nested(item)}`)
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
  private readonly wrappers = new Map<
    string,
    WrappedHostFunction<NativeConsoleMethod>
  >();
  private readonly subscribers = new Map<Emit, number>();

  constructor(private readonly window: Window & typeof globalThis) {
    const consoleObject = window.console as unknown as Record<string, unknown>;
    for (const [method, type] of Object.entries(CONSOLE_METHOD_TYPES)) {
      if (typeof consoleObject[method] !== "function") continue;
      this.wrappers.set(
        method,
        new WrappedHostFunction<NativeConsoleMethod>(
          consoleObject,
          method,
          (original, thisArg, args) =>
            this.observe(type, original, thisArg, args)
        )
      );
    }
  }

  /** Reports to `emit` until the returned release is called. */
  subscribe(emit: Emit): () => void {
    this.subscribers.set(emit, (this.subscribers.get(emit) ?? 0) + 1);
    const releases = [...this.wrappers.values()].map((wrapper) =>
      wrapper.subscribe()
    );
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

  private emit(call: ConsoleCall) {
    for (const subscriber of [...this.subscribers.keys()]) subscriber(call);
  }

  /**
   * A subscriber runs inside this document, unlike the pinned client's
   * Node-side listener: one that itself calls a wrapped `console.*` method
   * (directly, or indirectly by having this observation log a listener
   * failure through it) would otherwise re-enter `observe`, reporting that
   * call too, whose subscriber call could do the same, without end. The
   * pinned client's listener cannot cause this, since it runs in Node and
   * never reaches the page's `console`. Set for the duration of one
   * `emit`, so a call still reaches the original method but is not itself
   * reported while a report for an earlier call is in progress.
   */
  private emitting = false;

  /**
   * Pinned `console.assert`: the browser reports a call only when the
   * asserted condition is falsy. Every other wrapped method reports on every
   * call, as the pinned CDP `Runtime.consoleAPICalled` event does.
   */
  private observe(
    type: ConsoleMessageType,
    original: NativeConsoleMethod,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    const result = Reflect.apply(original, thisArg, args);
    if (type === "assert" && args[0]) return result;
    if (this.emitting) return result;
    this.emitting = true;
    try {
      this.emit({
        type,
        args,
        text: formatConsoleText(args),
        location: captureLocation(),
        timestamp: Date.now(),
      });
    } finally {
      this.emitting = false;
    }
    return result;
  }
}
