import { HostObservation, perWindow } from "./hostGlobals";
import { previewValue, tagOf, type AdapterJSHandle } from "./jsHandle";
import type { ConsoleMessage, JSHandle, Page } from "@playwright/test";

/** The `ConsoleMessage` object the `console` event and `consoleMessages()` report; re-exported from `src/index.ts` as an opt-in annotation. A browser-generated entry (a failed resource load, a CSP report) is never observed, since none calls a `console.*` method. */
export type { ConsoleMessage };

/** Pinned client/events.ts Page event this observation emits. */
export const CONSOLE_EVENT = "console";

type ConsoleMessageType = ReturnType<ConsoleMessage["type"]>;

/**
 * Builds a `ConsoleMessage`, this package's own `JSHandle`s cast to
 * Playwright's public `JSHandle` the way `createPage`'s `Page` types every
 * other adapter handle it returns. Built per subscribing `Page`, not inside
 * `ConsoleObservation`: `args()` must hold that page's own handles, which
 * only its `Evaluation` can create, and `page()` must return that same page.
 */
export function buildConsoleMessage(
  page: Page,
  type: ConsoleMessageType,
  args: AdapterJSHandle[],
  text: string,
  location: ReturnType<typeof captureLocation>,
  timestamp: number
): ConsoleMessage {
  return {
    args: () => args as unknown as JSHandle[],
    location: () => ({
      url: location.url,
      line: location.lineNumber,
      column: location.columnNumber,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
    }),
    page: () => page,
    text: () => text,
    timestamp: () => timestamp,
    type: () => type,
    worker: () => null,
  };
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
 * That fallback is the call's one argument, in `args()` as well as `text()`,
 * as V8's `reportCallWithDefaultArgument` passes it. `assert` falls back the
 * same way in `observe`, once its condition argument is dropped.
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
  /**
   * The raw arguments the Site passed (or the synthesized fallback of a
   * `FALLBACK_TEXT_METHODS` call), wrapped into `JSHandle`s per page.
   */
  args: unknown[];
  /** Pinned client/console.ts: joins each argument's object-preview text. */
  text: string;
  location: ReturnType<typeof captureLocation>;
  timestamp: number;
};

type Emit = (call: ConsoleCall) => void;
type NativeConsoleMethod = (...args: unknown[]) => unknown;

/**
 * Frames this module's own call chain adds, above the captured stack, before
 * the Site's own call site: `captureLocation` itself, `observe`, the
 * `HostMember` intercept callback, and the `Proxy` `apply` trap. A
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
function captureLocation() {
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
 * description, not V8's preview: no truncation, no sparse-array markers, and
 * a class instance passed directly lists its own members (`{a: 1}`) where
 * Playwright prints its constructor name (`Foo`).
 *
 * Like V8's preview, verified against real Chromium, it never calls the
 * Site's code: entries are read from property descriptors, an accessor
 * renders as `undefined` without being called, and a setter-only property
 * is left out.
 */
function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return `[${Array.from({ length: value.length }, (_, index) =>
      previewEntry(Object.getOwnPropertyDescriptor(value, index))
    ).join(", ")}]`;
  if (value !== null && typeof value === "object" && tagOf(value) === "Object")
    return `{${Object.keys(value)
      .map((key) => [key, Object.getOwnPropertyDescriptor(value, key)] as const)
      .filter(([, descriptor]) => descriptor && !isSetterOnly(descriptor))
      .map(([key, descriptor]) => `${key}: ${previewEntry(descriptor)}`)
      .join(", ")}}`;
  return previewValue(value);
}

/** An array hole renders empty, as `Array.prototype.join` renders it. */
function previewEntry(descriptor: PropertyDescriptor | undefined): string {
  if (!descriptor) return "";
  return "value" in descriptor ? previewValue(descriptor.value) : "undefined";
}

function isSetterOnly(descriptor: PropertyDescriptor): boolean {
  return !("value" in descriptor) && !descriptor.get;
}

/**
 * Pinned client/consoleMessage.ts `text()`: argument previews joined by a
 * space. The preview never calls Site code, but a Proxy's traps can still
 * throw; that argument then renders as `Object` rather than failing the
 * report.
 */
function formatConsoleText(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      try {
        return formatConsoleArg(arg);
      } catch {
        return "Object";
      }
    })
    .join(" ");
}

/** The one observation of a window's `console`, shared by every `Page` of it. */
export const consoleObservationFor = perWindow(
  (browserWindow) => new ConsoleObservation(browserWindow)
);

/**
 * Reports the document's `console.*` calls as Playwright's `console` event,
 * for as long as something is subscribed. Every wrapped method is installed
 * and restored together as one subscription.
 */
export class ConsoleObservation {
  private readonly host: HostObservation<Emit>;

  constructor(private readonly window: Window & typeof globalThis) {
    const holder = window.console as unknown as Record<string, unknown>;
    this.host = new HostObservation(
      Object.entries(CONSOLE_METHOD_TYPES)
        .filter(([method]) => typeof holder[method] === "function")
        .map(([method, type]) => ({
          holder,
          name: method,
          intercept: (original: NativeConsoleMethod, thisArg, args) =>
            this.observe(type, method, original, thisArg, args),
        }))
    );
  }

  /** Reports to `emit` until the returned release is called. */
  subscribe(emit: Emit): () => void {
    return this.host.subscribe(emit);
  }

  /** Guards one report against the reentrancy `observe` documents. */
  private emitting = false;

  /**
   * Pinned `console.assert`: reports only when the asserted condition is
   * falsy, and drops the condition from the reported arguments. Every
   * synthesized-fallback and bare-call-suppression rule is verified against
   * real Chromium; see `FALLBACK_TEXT_METHODS`/`SUPPRESSED_WHEN_EMPTY`.
   *
   * Observing never changes the Site's call: it returns the native method's
   * own result, and nothing that fails while building or emitting the report
   * reaches the caller; such a report is dropped instead.
   *
   * A subscriber runs inside this document, unlike the pinned client's
   * Node-side listener, so one that itself calls a wrapped method (including
   * indirectly, through this observation's own listener-failure logging)
   * would otherwise re-enter this method without end; `emitting` guards one
   * report against that, forwarding to the original method regardless.
   */
  private observe(
    type: ConsoleMessageType,
    method: string,
    original: NativeConsoleMethod,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    const result = Reflect.apply(original, thisArg, args);
    if (this.emitting) return result;
    this.emitting = true;
    try {
      if (method === "assert") {
        if (args[0]) return result;
        args = args.slice(1);
      }
      if (args.length === 0) {
        if (SUPPRESSED_WHEN_EMPTY.has(method)) return result;
        if (FALLBACK_TEXT_METHODS.has(method)) args = [`console.${method}`];
      }
      this.host.report({
        type,
        args,
        text: formatConsoleText(args),
        location: captureLocation(),
        timestamp: Date.now(),
      });
    } catch {
      // Dropped: see "Observing never changes the Site's call" above.
    } finally {
      this.emitting = false;
    }
    return result;
  }
}
