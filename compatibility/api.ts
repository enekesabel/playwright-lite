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
export const elementHandleLimitations =
  "Returned `ElementHandle` objects do not implement `contentFrame()`, `ownerFrame()`, `screenshot()`, `tap()`, `evaluateHandle()`, `jsonValue()`, `getProperties()`, `getProperty()`, or `[Symbol.asyncDispose]()`. Their `$()` ignores `strict`; `click()` does not wait for navigation; `waitForSelector()` rejects `strict`; `evaluate()` rejects `exposeFunctions: true`. The `JSHandle` returned by `waitForFunction()` does not implement `asElement()`, `evaluate()`, `evaluateHandle()`, `getProperties()`, `getProperty()`, or `[Symbol.asyncDispose]()`.";

export const pageLedger = {
  [Symbol.asyncDispose]: undecided(),
  $: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  $$: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
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
  check: implemented(),
  clearConsoleMessages: undecided(),
  clearPageErrors: undecided(),
  click: partial("The action does not wait for navigation."),
  clock: undecided(),
  close: undecided(),
  consoleMessages: undecided(),
  content: implemented("Serializes the current controlled document."),
  context: undecided(),
  coverage: undecided(),
  dblclick: implemented(),
  dispatchEvent: partial(
    "`JSHandle`/`ElementHandle` values in `eventInit` are not unwrapped."
  ),
  dragAndDrop: undecided(),
  emulateMedia: undecided(),
  evaluate: partial("Rejects `exposeFunctions: true`."),
  evaluateHandle: undecided(),
  exposeBinding: undecided(),
  exposeFunction: undecided(),
  fill: implemented(),
  focus: implemented(),
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
    'Does not return a `Response`; resolves to `null` only for same-document hash navigation. Relative URLs use `document.baseURI`, not a configured Playwright `baseURL`. Rejects `referer`, `signal`, and `waitUntil: "networkidle"`.'
  ),
  hideHighlight: implemented("Clears highlights in the current document."),
  hover: implemented(),
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
  mainFrame: partial("Returns the same `Page` object, not a `Frame`."),
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
  press: implemented(),
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
  selectOption: partial("`ElementHandle` option values are unsupported."),
  sessionStorage: implemented("Native current-window Storage only."),
  setChecked: implemented(),
  setContent: outOfScope("Document replacement is excluded."),
  setDefaultNavigationTimeout: implemented(),
  setDefaultTimeout: implemented(),
  setExtraHTTPHeaders: undecided(),
  setInputFiles: partial(
    "Accepts only in-memory `{ name, mimeType, buffer }` objects; file paths and directory uploads are unsupported. Empty `mimeType` throws instead of inferring a MIME type."
  ),
  setViewportSize: outOfScope("Browser viewport resizing is excluded."),
  tap: planned("Synthetic functional input only."),
  textContent: implemented(),
  title: implemented(),
  touchscreen: planned("Synthetic functional input only."),
  type: implemented(),
  uncheck: implemented(),
  unroute: undecided(),
  unrouteAll: undecided(),
  url: implemented(),
  video: undecided(),
  viewportSize: undecided(),
  waitForEvent: planned(
    "Only console and pageerror are planned; other events remain undecided."
  ),
  waitForFunction: partial(
    "The returned handle implements only `jsonValue()` and `dispose()`, even when the predicate returns a DOM node; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  waitForLoadState: undecided(),
  waitForNavigation: undecided(),
  waitForRequest: undecided(),
  waitForResponse: undecided(),
  waitForSelector: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
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
  check: implemented(),
  clear: implemented(),
  click: partial("The action does not wait for navigation."),
  contentFrame: outOfScope(
    "Iframe realms are outside the single-document boundary."
  ),
  count: implemented(),
  dblclick: implemented(),
  describe: implemented(),
  description: partial(
    "`describe('').description()` returns `''` instead of `null`; `describe('x').filter({}).description()` returns `null` instead of `'x'`."
  ),
  dispatchEvent: partial(
    "`JSHandle`/`ElementHandle` values in `eventInit` are not unwrapped."
  ),
  dragTo: undecided(),
  drop: undecided(),
  elementHandle: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  elementHandles: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  evaluate: partial("Rejects `exposeFunctions: true`."),
  evaluateAll: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateHandle: undecided(),
  fill: implemented(),
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
  hover: implemented(),
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
  press: implemented(),
  pressSequentially: implemented(),
  screenshot: undecided(),
  scrollIntoViewIfNeeded: implemented(),
  selectOption: partial("`ElementHandle` option values are unsupported."),
  selectText: implemented(),
  setChecked: implemented(),
  setInputFiles: partial(
    "Accepts only in-memory `{ name, mimeType, buffer }` objects; file paths and directory uploads are unsupported. Empty `mimeType` throws instead of inferring a MIME type."
  ),
  tap: undecided(),
  textContent: implemented(),
  toString: partial(
    "String representations can omit options: `filter({ hasText: 'x' })` prints `filter(...)`, and `page.getByRole('button', { disabled: true })` omits `disabled`."
  ),
  type: implemented(),
  uncheck: implemented(),
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
