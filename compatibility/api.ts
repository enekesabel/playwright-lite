import type {
  Keyboard,
  Locator,
  Mouse,
  Page,
  Touchscreen,
} from "@playwright/test";

export type CompatibilityStatus =
  "implemented" | "planned" | "undecided" | "out-of-scope";

export type CompatibilityEntry = {
  readonly status: CompatibilityStatus;
  readonly limitations?: string;
};

type Ledger<T> = Readonly<Record<keyof T, CompatibilityEntry>>;

const implemented = (limitations?: string): CompatibilityEntry => ({
  status: "implemented",
  ...(limitations ? { limitations } : {}),
});
const planned = (limitations?: string): CompatibilityEntry => ({
  status: "planned",
  ...(limitations ? { limitations } : {}),
});
const undecided = (): CompatibilityEntry => ({ status: "undecided" });
const outOfScope = (limitations: string): CompatibilityEntry => ({
  status: "out-of-scope",
  limitations,
});

/**
 * Human judgment over the pinned Playwright public API. This resource is
 * typechecked and consumed directly by test tooling, but is never imported by the
 * browser runtime.
 */
export const pageLedger = {
  [Symbol.asyncDispose]: undecided(),
  $: implemented("Adapter ElementHandle only."),
  $$: implemented("Adapter ElementHandle only."),
  $$eval: implemented(
    "Pinned client-protocol and UtilityScript serialization; caller closures and exposed function arguments are unsupported."
  ),
  $eval: implemented(
    "Pinned client-protocol and UtilityScript serialization; caller closures and exposed function arguments are unsupported."
  ),
  addInitScript: undecided(),
  addListener: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  addLocatorHandler: undecided(),
  addScriptTag: undecided(),
  addStyleTag: undecided(),
  ariaSnapshot: implemented("Current document only; no iframe traversal."),
  bringToFront: undecided(),
  cancelPickLocator: undecided(),
  check: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  clearConsoleMessages: undecided(),
  clearPageErrors: undecided(),
  click: implemented(
    "Browser-local pointer events, button/clickCount/delay/modifiers, force, position, scroll and trial; no trusted input, AbortSignal transport or navigation waiting."
  ),
  clock: undecided(),
  close: undecided(),
  consoleMessages: undecided(),
  content: implemented("Serializes the current controlled document."),
  context: undecided(),
  coverage: undecided(),
  dblclick: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  dispatchEvent: implemented("Accepts timeout and strict only."),
  dragAndDrop: undecided(),
  emulateMedia: undecided(),
  evaluate: implemented(
    "Pinned client-protocol and UtilityScript serialization; caller closures and exposed function arguments are unsupported."
  ),
  evaluateHandle: undecided(),
  exposeBinding: undecided(),
  exposeFunction: undecided(),
  fill: implemented("Accepts timeout and noWaitAfter only."),
  focus: implemented("Accepts timeout only."),
  frame: outOfScope("Iframe realms are outside the single-document boundary."),
  frameLocator: outOfScope(
    "Iframe realms are outside the single-document boundary."
  ),
  frames: outOfScope("Iframe realms are outside the single-document boundary."),
  getAttribute: implemented(),
  getByAltText: implemented(),
  getByLabel: implemented(),
  getByPlaceholder: implemented(),
  getByRole: implemented(),
  getByTestId: implemented(),
  getByText: implemented(),
  getByTitle: implemented(),
  goBack: planned(
    "Initiates browser navigation; execution ends on document replacement."
  ),
  goForward: planned(
    "Initiates browser navigation; execution ends on document replacement."
  ),
  goto: implemented(
    "Accepts http/https/about/file/data URLs and timeout, commit, domcontentloaded, or load waitUntil; full navigation ends execution."
  ),
  hideHighlight: implemented("Clears highlights in the current document."),
  hover: implemented(
    "Browser-local pointer events with modifiers, force, position, scroll, timeout and trial; native CSS hover state is not emulated."
  ),
  innerHTML: implemented(),
  innerText: implemented(),
  inputValue: implemented(),
  isChecked: implemented(),
  isClosed: undecided(),
  isDisabled: implemented(),
  isEditable: implemented(),
  isEnabled: implemented(),
  isHidden: implemented(),
  isVisible: implemented(),
  keyboard: implemented(
    "Synthetic current-document events and editable insertion only; browser cursor movement, deletion, focus traversal, and navigation defaults are not simulated."
  ),
  localStorage: implemented("Native current-window Storage only."),
  locator: implemented(),
  mainFrame: implemented("Returns the current Page facade, not a Frame."),
  mouse: planned("Synthetic functional input only."),
  off: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  on: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  once: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  opener: undecided(),
  pageErrors: undecided(),
  pause: undecided(),
  pdf: undecided(),
  pickLocator: undecided(),
  prependListener: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  press: implemented(
    "Accepts timeout and noWaitAfter only. Does not wait for navigation."
  ),
  reload: planned(
    "Initiates browser navigation; execution ends on document replacement."
  ),
  removeAllListeners: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  removeListener: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  removeLocatorHandler: undecided(),
  request: undecided(),
  requestGC: undecided(),
  requests: undecided(),
  route: undecided(),
  routeFromHAR: undecided(),
  routeWebSocket: undecided(),
  screencast: undecided(),
  screenshot: undecided(),
  selectOption: implemented(
    "Accepts strings, value/label/index objects, arrays, null, timeout, and noWaitAfter only."
  ),
  sessionStorage: implemented("Native current-window Storage only."),
  setChecked: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  setContent: outOfScope(
    "No single-document runtime implementation; native bridge calls are recorded and cannot certify browser behavior."
  ),
  setDefaultNavigationTimeout: implemented(),
  setDefaultTimeout: implemented(),
  setExtraHTTPHeaders: undecided(),
  setInputFiles: implemented(
    "In-memory payloads with explicit non-empty mimeType, under 50Mb total; accepts timeout, noWaitAfter, and strict. Paths, File, Blob, and directories throw."
  ),
  setViewportSize: outOfScope(
    "No single-document runtime implementation; native bridge calls are recorded and cannot certify browser behavior."
  ),
  tap: planned("Synthetic functional input only."),
  textContent: implemented(),
  title: implemented(),
  touchscreen: planned("Synthetic functional input only."),
  type: implemented("Accepts timeout, delay, and noWaitAfter only."),
  uncheck: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  unroute: undecided(),
  unrouteAll: undecided(),
  url: implemented(),
  video: undecided(),
  viewportSize: undecided(),
  waitForEvent: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  waitForFunction: implemented(
    "Serialized predicate source and arguments; the returned handle supports jsonValue and dispose only."
  ),
  waitForLoadState: undecided(),
  waitForNavigation: undecided(),
  waitForRequest: undecided(),
  waitForResponse: undecided(),
  waitForSelector: implemented(),
  waitForTimeout: implemented(),
  waitForURL: undecided(),
  workers: undecided(),
} as const satisfies Ledger<Page>;

export const locatorLedger = {
  all: implemented(
    "Captures the list length at call time and returns nth-index locators that re-query on use."
  ),
  allInnerTexts: implemented(),
  allTextContents: implemented(),
  and: implemented(),
  ariaSnapshot: implemented("Current document only; no iframe traversal."),
  blur: implemented(),
  boundingBox: implemented(),
  check: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  clear: implemented("Accepts timeout and noWaitAfter only."),
  click: implemented(
    "Browser-local pointer events, button/clickCount/delay/modifiers, force, position, scroll and trial; no trusted input, AbortSignal transport or navigation waiting."
  ),
  contentFrame: outOfScope(
    "Iframe realms are outside the single-document boundary."
  ),
  count: implemented(),
  dblclick: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  describe: implemented(),
  description: implemented(),
  dispatchEvent: implemented("Accepts timeout only."),
  dragTo: undecided(),
  drop: undecided(),
  elementHandle: implemented("Adapter ElementHandle only."),
  elementHandles: implemented("Adapter ElementHandle only."),
  evaluate: implemented(
    "Pinned client-protocol and UtilityScript serialization; caller closures and exposed function arguments are unsupported."
  ),
  evaluateAll: implemented(
    "Pinned client-protocol and UtilityScript serialization; caller closures and exposed function arguments are unsupported."
  ),
  evaluateHandle: undecided(),
  fill: implemented("Accepts timeout and noWaitAfter only."),
  filter: implemented(),
  first: implemented(),
  focus: implemented(),
  frameLocator: outOfScope(
    "Iframe realms are outside the single-document boundary."
  ),
  getAttribute: implemented(),
  getByAltText: implemented(),
  getByLabel: implemented(),
  getByPlaceholder: implemented(),
  getByRole: implemented(),
  getByTestId: implemented(),
  getByText: implemented(),
  getByTitle: implemented(),
  hideHighlight: implemented(
    "Removes this locator's highlight in the current document."
  ),
  highlight: implemented(
    "Uses the pinned InjectedScript overlay in the current document."
  ),
  hover: implemented(
    "Browser-local pointer events with modifiers, force, position, scroll, timeout and trial; native CSS hover state is not emulated."
  ),
  innerHTML: implemented(),
  innerText: implemented(),
  inputValue: implemented(),
  isChecked: implemented(),
  isDisabled: implemented(),
  isEditable: implemented(),
  isEnabled: implemented(),
  isHidden: implemented(),
  isVisible: implemented(),
  last: implemented(),
  locator: implemented(),
  normalize: undecided(),
  nth: implemented(),
  or: implemented(),
  page: implemented("Returns the adapter Page facade."),
  press: implemented(
    "Accepts timeout and noWaitAfter only. Does not wait for navigation."
  ),
  pressSequentially: implemented(
    "Accepts timeout, delay, and noWaitAfter only."
  ),
  screenshot: undecided(),
  scrollIntoViewIfNeeded: implemented("Accepts timeout only."),
  selectOption: implemented(
    "Accepts strings, value/label/index objects, arrays, null, timeout, and noWaitAfter only."
  ),
  selectText: implemented("Accepts timeout only."),
  setChecked: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  setInputFiles: implemented(
    "In-memory payloads with explicit non-empty mimeType, under 50Mb total; accepts timeout and noWaitAfter only. Paths, File, Blob, and directories throw."
  ),
  tap: undecided(),
  textContent: implemented(),
  toString: implemented(),
  type: implemented("Accepts timeout, delay, and noWaitAfter only."),
  uncheck: implemented(
    "Browser-local pointer events with force, position, scroll, timeout and trial; no trusted input or AbortSignal transport."
  ),
  waitFor: implemented(),
  waitForFunction: undecided(),
} as const satisfies Ledger<Locator>;

export const keyboardLedger = {
  down: implemented("Synthetic current-document keyboard events only."),
  insertText: implemented("Synthetic editable insertion only."),
  press: implemented("Synthetic current-document keyboard events only."),
  type: implemented("Synthetic editable insertion only."),
  up: implemented("Synthetic current-document keyboard events only."),
} as const satisfies Ledger<Keyboard>;

export const mouseLedger = {
  click: planned("Synthetic functional input only."),
  dblclick: planned("Synthetic functional input only."),
  down: planned("Synthetic functional input only."),
  move: planned("Synthetic functional input only."),
  up: planned("Synthetic functional input only."),
  wheel: planned("Synthetic functional input only."),
} as const satisfies Ledger<Mouse>;

export const touchscreenLedger = {
  tap: planned("Synthetic functional input only."),
} as const satisfies Ledger<Touchscreen>;

export const ledgers = {
  Page: pageLedger,
  Locator: locatorLedger,
  Keyboard: keyboardLedger,
  Mouse: mouseLedger,
  Touchscreen: touchscreenLedger,
} as const;

export function statusFor(owner: keyof typeof ledgers, member: string) {
  const ledger = ledgers[owner] as Readonly<
    Record<string | symbol, CompatibilityEntry>
  >;
  return ledger[member]?.status;
}
