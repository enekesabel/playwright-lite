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
  "Returned `ElementHandle` objects do not implement `contentFrame()`, `ownerFrame()`, `screenshot()`, or `tap()`. Their `$()` ignores `strict`; `click()` does not wait for navigation; `waitForSelector()` rejects `strict`; `evaluate()` rejects `exposeFunctions: true`. A returned `JSHandle` or `ElementHandle` builds its `toString()` preview from the referenced value inside the document instead of reading a browser-process object description: the preview describes the value as it is when the handle is first converted to a string, and a handle to a `Proxy` prints the target's class name, such as `Object`, where Playwright prints `Proxy(Object)`.";

const framenavigatedPayload =
  "`framenavigated` fires with the `Page` itself, the object `mainFrame()` returns, up to 20 ms after a same-document URL change. `pushState` and `replaceState` are sampled every 20 ms: several within one interval produce one event, and a URL that changes and changes back within one interval produces none.";
const eventListenerLimitations = `Events: \`framenavigated\`, \`pageerror\`. Other event names are accepted but never fire. ${framenavigatedPayload}`;
const eventRemovalLimitations =
  "Events: `framenavigated`, `pageerror`. Other event names are accepted.";
const waitForEventLimitations = `Events: \`framenavigated\`, \`pageerror\`. Other event names are accepted and time out. ${framenavigatedPayload}`;

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
  addListener: partial(eventListenerLimitations),
  addLocatorHandler: undecided(),
  addScriptTag: partial(
    "Rejects `path`, which reads the script from disk. Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  addStyleTag: partial(
    "Rejects `path`, which reads the stylesheet from disk. Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
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
  dispatchEvent: implemented(),
  dragAndDrop: undecided(),
  emulateMedia: undecided(),
  evaluate: partial("Rejects `exposeFunctions: true`."),
  evaluateHandle: partial(
    "Rejects `exposeFunctions: true`. The returned handle previews differently; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
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
  off: partial(eventRemovalLimitations),
  on: partial(eventListenerLimitations),
  once: partial(eventListenerLimitations),
  opener: undecided(),
  pageErrors: undecided(),
  pause: undecided(),
  pdf: undecided(),
  pickLocator: undecided(),
  prependListener: partial(eventListenerLimitations),
  press: implemented(),
  reload: planned(
    "Initiates browser navigation; execution ends on document replacement."
  ),
  removeAllListeners: partial(eventRemovalLimitations),
  removeListener: partial(eventRemovalLimitations),
  removeLocatorHandler: undecided(),
  request: undecided(),
  requestGC: undecided(),
  requests: undecided(),
  route: undecided(),
  routeFromHAR: undecided(),
  routeWebSocket: undecided(),
  screencast: undecided(),
  screenshot: undecided(),
  selectOption: implemented(),
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
  waitForEvent: partial(waitForEventLimitations),
  waitForFunction: partial(
    "The returned handle previews differently; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  waitForLoadState: partial("Rejects `networkidle`."),
  waitForNavigation: undecided(),
  waitForRequest: undecided(),
  waitForResponse: undecided(),
  waitForSelector: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  waitForTimeout: implemented(),
  waitForURL: partial('Rejects `waitUntil: "networkidle"`.'),
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
  dispatchEvent: implemented(),
  dragTo: undecided(),
  drop: partial(
    "Accepts only in-memory `{ name, mimeType, buffer }` file payloads; file paths are unsupported. Empty `mimeType` throws instead of inferring a MIME type."
  ),
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
  evaluateHandle: partial(
    "Rejects `exposeFunctions: true`. The returned handle previews differently; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
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
  selectOption: implemented(),
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
  waitForFunction: partial(
    "A promise returned by the page function is awaited before its value is judged; Playwright treats the returned promise object itself as truthy and stops waiting."
  ),
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

/** The public in-browser expect foundation and its owner-specific assertions. */
export const expectLedger = {
  "expect(value)": implemented(
    "Supports Playwright's generic value matchers, asymmetric matching, `.not`, `.resolves`, `.rejects`, and custom messages. `expect(locator)` also supports the documented Locator assertions."
  ),
  "expect.extend()": implemented(),
  "expect.configure()": partial(
    "Supports `timeout` and `message`. The `soft` option throws because playwright-lite has no Playwright Test failure-reporting context."
  ),
  "expect.poll()": implemented(),
  "toPass()": implemented(),
  "expect.soft()": outOfScope(
    "Throws because playwright-lite has no Playwright Test failure-reporting context."
  ),
  "expect(page).toHaveTitle()": implemented(
    "Supports string and RegExp expectations with `ignoreCase`, `timeout`, and `signal` options."
  ),
  "expect(page).toHaveURL()": partial(
    "Supports string/glob, RegExp, URL predicates, and URLPattern values with `ignoreCase`, `timeout`, and `signal`; string expectations are matched against the current document because this runtime has no configured Playwright `baseURL`."
  ),
  "Locator assertions": implemented(
    "Supports `toBeAttached`, `toBeChecked`, `toBeDisabled`, `toBeEditable`, `toBeEmpty`, `toBeEnabled`, `toBeFocused`, `toBeHidden`, `toBeInViewport`, `toBeVisible`, `toContainText`, `toContainClass`, `toHaveAccessibleDescription`, `toHaveAccessibleName`, `toHaveAccessibleErrorMessage`, `toHaveAttribute`, `toHaveClass`, `toHaveCount`, `toHaveCSS`, `toHaveId`, `toHaveJSProperty`, `toHaveRole`, `toHaveText`, `toHaveValue`, `toHaveValues`, and inline-string `toMatchAriaSnapshot`. `toHaveScreenshot` and file/config-driven ARIA snapshot forms are excluded."
  ),
  "Filesystem-backed snapshot assertions": outOfScope(
    "They require filesystem and test-runner state that is unavailable in the browser document."
  ),
  "API response assertions": outOfScope(
    "They operate on Playwright's Node-side API response objects, which have no in-document counterpart."
  ),
} as const satisfies Readonly<Record<string, CompatibilityEntry>>;

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
