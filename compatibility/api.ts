import type {
  Keyboard,
  Locator,
  Mouse,
  Page,
  Touchscreen,
} from "@playwright/test";

export type CompatibilityStatus =
  "implemented" | "planned" | "undecided" | "out-of-scope";

/**
 * API compatibility within the README runtime boundaries, not test coverage.
 * Full means no known method-specific gap; partial requires a consumer-facing
 * explanation of missing options, return semantics, or behavior. Runtime-wide
 * constraints do not downgrade APIs. Review pinned signatures, runtime behavior,
 * and reviewed test evidence before upgrading a claim; a passing test is not
 * proof of the whole API. Planned and undecided both mean not implemented.
 */
export type CompatibilityEntry = { readonly limitations?: string } & (
  | { readonly status: "implemented"; readonly apiCompatibility: "full" }
  | {
      readonly status: "implemented";
      readonly apiCompatibility: "partial";
      readonly limitations: string;
    }
  | { readonly status: Exclude<CompatibilityStatus, "implemented"> }
);

type Ledger<T> = Readonly<Record<keyof T, CompatibilityEntry>>;

const implemented = (limitations?: string): CompatibilityEntry => ({
  status: "implemented",
  apiCompatibility: "full",
  ...(limitations ? { limitations } : {}),
});
const partial = (limitations: string): CompatibilityEntry => ({
  status: "implemented",
  apiCompatibility: "partial",
  limitations,
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
  $: partial(
    "Returns a limited ElementHandle; handle actions and evaluateHandle are not implemented."
  ),
  $$: partial(
    "Returns limited ElementHandles; handle actions and evaluateHandle are not implemented."
  ),
  $$eval: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  $eval: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
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
  check: partial(
    "Requires a single match. Options: timeout, noWaitAfter, position, trial only."
  ),
  clearConsoleMessages: undecided(),
  clearPageErrors: undecided(),
  click: partial(
    "Requires a single match. Options: timeout, noWaitAfter, position, trial only."
  ),
  clock: undecided(),
  close: undecided(),
  consoleMessages: undecided(),
  content: implemented("Serializes the current controlled document."),
  context: undecided(),
  coverage: undecided(),
  dblclick: partial(
    "Requires a single match. Options: timeout, noWaitAfter, position, trial only."
  ),
  dispatchEvent: partial(
    "Options: timeout and strict only; handle-valued eventInit is not supported."
  ),
  dragAndDrop: undecided(),
  emulateMedia: undecided(),
  evaluate: partial("The exposeFunctions: true option is not supported."),
  evaluateHandle: undecided(),
  exposeBinding: undecided(),
  exposeFunction: undecided(),
  fill: partial(
    "Requires a single match. Options: timeout and noWaitAfter only."
  ),
  focus: partial(
    "Requires a single match. Only the timeout option is supported."
  ),
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
  goto: partial(
    "No Response result. Options: timeout and waitUntil (commit, domcontentloaded, load) only; no referer, signal, or networkidle."
  ),
  hideHighlight: implemented("Clears highlights in the current document."),
  hover: partial(
    "Requires a single match. Options: timeout and noWaitAfter only."
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
  mainFrame: partial("Returns the Page facade, not a Frame."),
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
  press: partial(
    "Requires a single match. Options: timeout and noWaitAfter only; no delay or signal."
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
  selectOption: partial(
    "Requires a single match. No ElementHandle values. Options: timeout and noWaitAfter only."
  ),
  sessionStorage: implemented("Native current-window Storage only."),
  setChecked: partial(
    "Requires a single match. Options: timeout, noWaitAfter, position, trial only."
  ),
  setContent: outOfScope("Document replacement is excluded."),
  setDefaultNavigationTimeout: implemented(),
  setDefaultTimeout: implemented(),
  setExtraHTTPHeaders: undecided(),
  setInputFiles: partial(
    "In-memory payloads with a non-empty mimeType only; no paths or directories. Options: timeout, noWaitAfter, strict only."
  ),
  setViewportSize: outOfScope("Browser viewport resizing is excluded."),
  tap: planned("Synthetic functional input only."),
  textContent: implemented(),
  title: implemented(),
  touchscreen: planned("Synthetic functional input only."),
  type: partial(
    "Requires a single match. Options: timeout, delay, noWaitAfter only."
  ),
  uncheck: partial(
    "Requires a single match. Options: timeout, noWaitAfter, position, trial only."
  ),
  unroute: undecided(),
  unrouteAll: undecided(),
  url: implemented(),
  video: undecided(),
  viewportSize: undecided(),
  waitForEvent: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  waitForFunction: partial(
    "No signal option. The returned handle supports jsonValue and dispose only."
  ),
  waitForLoadState: undecided(),
  waitForNavigation: undecided(),
  waitForRequest: undecided(),
  waitForResponse: undecided(),
  waitForSelector: partial(
    "No signal option. Returns a limited ElementHandle without handle actions or evaluateHandle."
  ),
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
  check: partial("Options: timeout, noWaitAfter, position, trial only."),
  clear: partial("Options: timeout and noWaitAfter only; no force or signal."),
  click: partial("Options: timeout, noWaitAfter, position, trial only."),
  contentFrame: outOfScope(
    "Iframe realms are outside the single-document boundary."
  ),
  count: implemented(),
  dblclick: partial("Options: timeout, noWaitAfter, position, trial only."),
  describe: implemented(),
  description: partial(
    "Empty descriptions and descriptions retained through filter() differ from Playwright."
  ),
  dispatchEvent: partial(
    "Only the timeout option is supported; handle-valued eventInit is not supported."
  ),
  dragTo: undecided(),
  drop: undecided(),
  elementHandle: partial(
    "Returns a limited ElementHandle; handle actions and evaluateHandle are not implemented."
  ),
  elementHandles: partial(
    "Returns limited ElementHandles; handle actions and evaluateHandle are not implemented."
  ),
  evaluate: partial("The exposeFunctions: true option is not supported."),
  evaluateAll: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateHandle: undecided(),
  fill: partial("Options: timeout and noWaitAfter only; no force or signal."),
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
  hover: partial("Options: timeout and noWaitAfter only."),
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
  press: partial(
    "Options: timeout and noWaitAfter only; no delay or signal."
  ),
  pressSequentially: partial("The signal option is not supported."),
  screenshot: undecided(),
  scrollIntoViewIfNeeded: partial("The signal option is not supported."),
  selectOption: partial(
    "No ElementHandle values. Options: timeout and noWaitAfter only; no force or signal."
  ),
  selectText: partial(
    "Only the timeout option is supported; no force or signal."
  ),
  setChecked: partial("Options: timeout, noWaitAfter, position, trial only."),
  setInputFiles: partial(
    "In-memory payloads with a non-empty mimeType only; no paths or directories. Options: timeout and noWaitAfter only; no signal."
  ),
  tap: undecided(),
  textContent: implemented(),
  toString: partial(
    "Uses construction labels rather than Playwright's normalized selector descriptions."
  ),
  type: partial("The signal option is not supported."),
  uncheck: partial("Options: timeout, noWaitAfter, position, trial only."),
  waitFor: partial("The signal option is not supported."),
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
