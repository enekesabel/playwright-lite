import type {
  expect,
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

/*
 * Everything below is human judgment over the pinned Playwright public API.
 * This resource is typechecked and consumed directly by test tooling, but is
 * never imported by the browser runtime.
 */

/** One `### ` section describing a returned object: see the README template. */
export type ObjectSection = {
  readonly name: string;
  readonly covers: string;
  readonly notAvailable: string;
  readonly differences: readonly string[];
};

/** One row of the README Events table. */
export type EventRow = {
  readonly events: readonly string[];
  readonly firesFor: string;
  readonly differences: string;
};

const elementHandleNote =
  "Returned `ElementHandle` methods and options differ; see [ElementHandle and JSHandle](#elementhandle-and-jshandle).";
const handlePreviewNote =
  "The returned handle previews differently; see [ElementHandle and JSHandle](#elementhandle-and-jshandle).";
const listenerNote =
  "Fires only the [supported events](#events); other names never fire.";
const removalNote =
  "Only the [supported events](#events) ever fire; other names are accepted.";
const waitForEventNote =
  "Resolves only for the [supported events](#events); other names time out.";
const networkObservationNote =
  "`fetch()` and `XMLHttpRequest` calls of the current document only; see [Request and Response](#request-and-response).";
const exposeFunctionNote =
  "`dispose()` leaves a value the page itself assigned to the property on `window`, where Playwright deletes it. Arguments and the result skip `JSON.stringify()`, so a page overriding `Array.prototype.toJSON()` does not make the call reject, as it does in Playwright.";
const exposeBindingNote =
  "Differs as `exposeFunction` does. The callback's `source` is `{ page, frame: page }`, with no `context`, since this package has no `BrowserContext`.";
const consoleMessagesNote =
  '`filter: "all"` and the default `"since-navigation"` return the same messages; see [ConsoleMessage](#consolemessage).';
const networkIdleNote =
  '`"networkidle"` resolves no sooner than 500 ms after the call, even when the document is already idle; see [Runtime boundaries](#runtime-boundaries).';

/** The Page events this package fires, in README order. */
export const events: readonly EventRow[] = [
  {
    events: ["dialog"],
    firesFor:
      "`window.alert()`, `window.confirm()` and `window.prompt()` calls the document makes while a listener is registered.",
    differences:
      "A listener settles the dialog only synchronously; see [Dialog](#dialog).",
  },
  {
    events: ["framenavigated"],
    firesFor: "Same-document URL changes while a listener is registered.",
    differences:
      "Fires with the `Page` itself, the object `mainFrame()` returns, up to 20 ms after the change. The URL is sampled every 20 ms: several changes within one interval fire once, and a URL that changes and changes back within one interval fires nothing.",
  },
  {
    events: ["pageerror"],
    firesFor:
      "Uncaught errors and unhandled promise rejections of the current document.",
    differences: "",
  },
  {
    events: ["request", "response", "requestfinished", "requestfailed"],
    firesFor:
      "`fetch()` and `XMLHttpRequest` calls the document makes while a listener is registered.",
    differences: "See [Request and Response](#request-and-response).",
  },
  {
    events: ["console"],
    firesFor:
      "The document's own `console.*` calls made while a listener is registered.",
    differences: "See [ConsoleMessage](#consolemessage).",
  },
];

/** Returned objects, in README order. Each behaviour lives in one section. */
export const objectSections: readonly ObjectSection[] = [
  {
    name: "ElementHandle and JSHandle",
    covers:
      "The `ElementHandle` and `JSHandle` objects this package returns, for example from `$()`, `waitForSelector()`, `evaluateHandle()` or `locator.elementHandle()`.",
    notAvailable:
      "`ElementHandle.contentFrame()`, `ownerFrame()`, `screenshot()` and `tap()`. `JSHandle` has every member.",
    differences: [
      "`ElementHandle.$()` ignores `strict`.",
      "`ElementHandle.click()` does not wait for navigation.",
      "`ElementHandle.waitForSelector()` rejects `strict`.",
      "`toString()` builds its preview from the referenced value inside the document instead of reading a browser-process object description, so it describes the value as it is when the handle is first converted to a string.",
      "`toString()` of a handle to a `Proxy` prints the target's class name, such as `Object`, where Playwright prints `Proxy(Object)`.",
    ],
  },
  {
    name: "Request and Response",
    covers:
      '`page.on("request" | "response" | "requestfinished" | "requestfailed")`, `page.waitForRequest()`, `page.waitForResponse()` and `page.requests()` report the `fetch()` and `XMLHttpRequest` calls the current document makes while you are subscribed. Images, scripts, stylesheets, `navigator.sendBeacon`, `WebSocket`, `EventSource`, form submissions and navigations are not reported, and neither are `fetch()` and `XMLHttpRequest` calls made by another realm, by an iframe or by a service worker, nor a `fetch()` call started or an `XMLHttpRequest` opened before the first subscription. The package exports `Request` and `Response` types listing exactly the available members. Annotating a value with one of them is optional: `createPage()` returns Playwright\'s own `Page`, so code written against Playwright keeps type-checking here.',
    notAvailable:
      "`Request.allHeaders()`, `existingResponse()`, `frame()`, `headersArray()`, `redirectedFrom()`, `redirectedTo()`, `serviceWorker()`, `sizes()` and `timing()`; `Response.allHeaders()`, `frame()`, `fromServiceWorker()`, `headersArray()`, `headerValues()`, `httpVersion()`, `securityDetails()` and `serverAddr()`. Calling one throws a `TypeError`.",
    differences: [
      '`resourceType()` is `"fetch"` or `"xhr"`, and `isNavigationRequest()` is always `false`.',
      "`Request.headers()` and `Request.headerValue()` report the headers the call set (the `Request` headers of a `fetch()`, the `setRequestHeader()` values of an `XMLHttpRequest`), not the headers that went on the wire: `Cookie`, `Origin`, `User-Agent` and the other headers the browser adds are missing, as is the `Content-Type` an `XMLHttpRequest` derives from its `send()` body. Playwright's `headerValue()` reads the wire headers.",
      "`Response.headers()` and `Response.headerValue()` report the headers the browser exposes to the document: `Set-Cookie` is never among them, and a cross-origin response exposes only the CORS-safelisted names plus the ones its `Access-Control-Expose-Headers` lists.",
      "`postData()`, `postDataBuffer()` and `postDataJSON()` answer without waiting, as Playwright's do, so they read only a body the call hands over synchronously: a string, `URLSearchParams`, an `ArrayBuffer` or a typed array, passed as the `fetch()` `body` option or as the `send()` argument. A `Blob`, `FormData` or `ReadableStream` body, and a body carried by a `Request` argument to `fetch()`, report `null`.",
      "`postDataBuffer()` returns a `Uint8Array` and `Response.body()` resolves with a `Uint8Array`, where Playwright returns a Node.js `Buffer`.",
      "`failure().errorText` is the name and message of the error the `fetch()` call rejected with, or the reason its `AbortSignal` carried. An `XMLHttpRequest` reports `XMLHttpRequest:` followed by the name of the event that ended it: `error`, `timeout` or `abort`, which is also what an `XMLHttpRequest` opened again while in flight reports. Playwright reports the browser's `net::ERR_*` code.",
      "A redirect chain is one request and one response: the request reports the URL the document asked for, the response reports the final URL, and no event is emitted per hop.",
      "`Response.finished()` resolves once the response body has ended. A `fetch()` response body is buffered as it arrives, so `body()`, `text()` and `json()` still answer after the document consumed it.",
      '`body()`, `text()` and `json()` of an `XMLHttpRequest` read the body back from the request once it is done. With the default `responseType` the browser has already decoded it as text, so they return it re-encoded as UTF-8, and a binary or non-UTF-8 body does not come back byte for byte; Playwright returns the bytes received. They reject when the request set `responseType` to `"json"` or `"document"`, because the browser then keeps only the value it parsed.',
    ],
  },
  {
    name: "Dialog",
    covers:
      '`page.on("dialog")` reports the `window.alert()`, `window.confirm()` and `window.prompt()` calls the current document makes, wrapped as Playwright\'s `Dialog`. The package exports a `Dialog` type listing exactly its members.',
    notAvailable: "none; `Dialog` has every member.",
    differences: [
      "A `dialog` listener must call `accept()` or `dismiss()` synchronously, before returning control to the wrapped call, for that call to decide the result: `window.alert()`, `window.confirm()` and `window.prompt()` block the document's own script until they return. Playwright settles a dialog whenever the listener calls `accept()` or `dismiss()`, however much later.",
      "A dialog no listener settles synchronously is dismissed once every listener has run, and the wrapped call returns the dismissed value: `undefined` for `alert()`, `false` for `confirm()`, `null` for `prompt()`. Playwright auto-dismisses only when a page has no `dialog` listener at all.",
      "With no `dialog` listener, the page is left untouched: the browser shows its own dialog and the page waits for a person, where Playwright dismisses it.",
      'A dialog resolved from `waitForEvent("dialog")` is already dismissed by the time the promise resolves, so `(await page.waitForEvent("dialog")).accept()` rejects.',
      "Pages sharing one window share one dialog settlement: the first `accept()` or `dismiss()` call, from any of them, wins, and a later one rejects.",
      "`beforeunload` dialogs are never reported.",
    ],
  },
  {
    name: "ConsoleMessage",
    covers:
      "`page.on(\"console\")` and `page.consoleMessages()` report the document's own `console.log()`, `debug()`, `info()`, `error()`, `warn()`, `dir()`, `dirxml()`, `table()`, `trace()`, `clear()`, `group()`, `groupCollapsed()`, `groupEnd()`, `assert()`, `profile()`, `profileEnd()`, `count()`, `timeEnd()` and `timeLog()` calls, wrapped as Playwright's `ConsoleMessage`.",
    notAvailable: "none; `ConsoleMessage` has every member.",
    differences: [
      'Only a `console.*` call made after you first subscribe with `page.on("console")` or call `page.consoleMessages()` is reported; an earlier call is never observed. `consoleMessages()` keeps reading calls made after that first read, the same way `requests()` does.',
      '`consoleMessages()` returns the same messages for `filter: "all"` and the default `"since-navigation"`, since nothing ever marks the buffer at a navigation.',
      "A browser-generated console entry, such as a failed resource load or a Content-Security-Policy violation report, never calls a `console.*` method, so it is never reported.",
      "`timeEnd()`, `timeLog()` and `count()` report only the label the call passed, not the elapsed time or count the browser computes internally.",
      "`text()`'s object and array previews list their own entries one level deep, each rendered the way this package's own `JSHandle` description renders it, rather than the browser's own preview algorithm: no truncation, no sparse-array markers, and a class instance passed directly as an argument lists its own members (`{a: 1}`) where Playwright prints its constructor name (`Foo`).",
      "Building a `text()` preview never calls the page's getters, but it does run a `Proxy` argument's traps, which the browser's own preview never does. A trap that throws leaves that argument previewed as `Object`, and a revoked `Proxy` argument stops the message from being reported; the `console.*` call itself returns and behaves as it does unobserved.",
      "`location()` is reconstructed from the calling script's own stack at the point of the call, not the browser's own recorded call-site data: engine stack-formatting differences and inlining can shift or drop a frame.",
      "Wrapping a `console.*` method adds a frame of its own to any stack the browser captures while it is wrapped, including DevTools' own call-site link for a logged message and the stack `console.trace()` itself prints: both point partway into this package's own code, not only at the calling script.",
      "A `console.*` call made from inside a `console` listener is forwarded to the real method but does not itself fire another `console` event, so a listener that logs cannot trigger itself.",
    ],
  },
];

export const pageLedger = {
  [Symbol.asyncDispose]: undecided(),
  $: partial(elementHandleNote),
  $$: partial(elementHandleNote),
  $$eval: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  $eval: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  addInitScript: outOfScope(
    "Registers a script to run before the document's own scripts, which have already run by the time this adapter attaches."
  ),
  addListener: partial(listenerNote),
  addLocatorHandler: undecided(),
  addScriptTag: partial(
    "Rejects `path`, which reads the script from disk. Returned `ElementHandle` methods and options differ; see [ElementHandle and JSHandle](#elementhandle-and-jshandle)."
  ),
  addStyleTag: partial(
    "Rejects `path`, which reads the stylesheet from disk. Returned `ElementHandle` methods and options differ; see [ElementHandle and JSHandle](#elementhandle-and-jshandle)."
  ),
  ariaSnapshot: implemented("Current document only; no iframe traversal."),
  bringToFront: outOfScope("Browser tab focus control is excluded."),
  cancelPickLocator: undecided(),
  check: implemented(),
  clearConsoleMessages: implemented(),
  clearPageErrors: implemented(),
  click: partial("The action does not wait for navigation."),
  clock: undecided(),
  close: undecided(),
  consoleMessages: partial(consoleMessagesNote),
  content: implemented("Serializes the current controlled document."),
  context: outOfScope(
    "Refers to the owning browser context, which does not exist in this adapter."
  ),
  coverage: outOfScope(
    "Collecting code coverage requires the browser process."
  ),
  dblclick: implemented(),
  dispatchEvent: implemented(),
  dragAndDrop: undecided(),
  emulateMedia: undecided(),
  evaluate: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateHandle: partial(handlePreviewNote),
  exposeBinding: partial(exposeBindingNote),
  exposeFunction: partial(exposeFunctionNote),
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
    "Does not return a `Response`; resolves to `null` only for same-document hash navigation. Relative URLs use `document.baseURI`, not a configured Playwright `baseURL`. Rejects `referer` and `signal`. " +
      networkIdleNote
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
  off: partial(removalNote),
  on: partial(listenerNote),
  once: partial(listenerNote),
  opener: outOfScope(
    "Refers to another page, outside the single-document boundary."
  ),
  pageErrors: partial(
    '`filter: "all"` and the default `"since-navigation"` return the same errors: this single-document adapter never crosses documents within one page\'s lifetime, so nothing ever marks the buffer at a navigation.'
  ),
  pause: outOfScope(
    "Pausing for the Playwright Inspector requires the browser process."
  ),
  pdf: outOfScope("Generating a PDF requires the browser process."),
  pickLocator: undecided(),
  prependListener: partial(listenerNote),
  press: implemented(),
  reload: planned(
    "Initiates browser navigation; execution ends on document replacement."
  ),
  removeAllListeners: partial(removalNote),
  removeListener: partial(removalNote),
  removeLocatorHandler: undecided(),
  request: outOfScope(
    "Returns Playwright's Node-side API request context, which has no in-document counterpart."
  ),
  requestGC: outOfScope(
    "Forcing garbage collection requires the browser process."
  ),
  requests: partial(networkObservationNote),
  route: outOfScope("Browser-level network interception is excluded."),
  routeFromHAR: outOfScope("Browser-level network interception is excluded."),
  routeWebSocket: outOfScope("Browser-level network interception is excluded."),
  screencast: outOfScope(
    "Capturing a screencast requires the browser process."
  ),
  screenshot: undecided(),
  selectOption: implemented(),
  sessionStorage: implemented("Native current-window Storage only."),
  setChecked: implemented(),
  setContent: outOfScope("Document replacement is excluded."),
  setDefaultNavigationTimeout: implemented(),
  setDefaultTimeout: implemented(),
  setExtraHTTPHeaders: outOfScope(
    "Browser-level request header configuration is excluded."
  ),
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
  unroute: outOfScope(
    "Removes handlers registered by `route()`, which is excluded."
  ),
  unrouteAll: outOfScope(
    "Removes handlers registered by `route()`, which is excluded."
  ),
  url: implemented(),
  video: outOfScope("Recording video requires the browser process."),
  viewportSize: undecided(),
  waitForEvent: partial(waitForEventNote),
  waitForFunction: partial(handlePreviewNote),
  waitForLoadState: partial(networkIdleNote),
  waitForNavigation: undecided(),
  waitForRequest: partial(networkObservationNote),
  waitForResponse: partial(networkObservationNote),
  waitForSelector: partial(elementHandleNote),
  waitForTimeout: implemented(),
  waitForURL: partial(networkIdleNote),
  workers: outOfScope(
    "Worker realms are outside the single-document boundary."
  ),
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
  elementHandle: partial(elementHandleNote),
  elementHandles: partial(elementHandleNote),
  evaluate: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateAll: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateHandle: partial(handlePreviewNote),
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

/**
 * Assertion names `expect(target)` offers for `T` in pinned Playwright, minus
 * the generic matchers every target shares.
 */
type AssertionName<T> = Exclude<
  keyof ReturnType<typeof expect<T>>,
  | "not"
  | "resolves"
  | "rejects"
  | "toBe"
  | "toBeDefined"
  | "toBeFalsy"
  | "toBeNull"
  | "toBeTruthy"
  | "toBeUndefined"
>;

const screenshotExcluded =
  "Comparing against a stored screenshot requires the filesystem and the test runner.";

/** `expect(locator)` matchers. */
export const locatorAssertionLedger = {
  toBeAttached: implemented(),
  toBeChecked: implemented(),
  toBeDisabled: implemented(),
  toBeEditable: implemented(),
  toBeEmpty: implemented(),
  toBeEnabled: implemented(),
  toBeFocused: implemented(),
  toBeHidden: implemented(),
  toBeInViewport: implemented(),
  toBeVisible: implemented(),
  toContainClass: partial(
    "A RegExp `expected` rejects the returned promise, where Playwright throws synchronously."
  ),
  toContainText: implemented(),
  toHaveAccessibleDescription: implemented(),
  toHaveAccessibleErrorMessage: implemented(),
  toHaveAccessibleName: implemented(),
  toHaveAttribute: implemented(),
  toHaveClass: implemented(),
  toHaveCount: implemented(),
  toHaveCSS: implemented(),
  toHaveId: implemented(),
  toHaveJSProperty: implemented(),
  toHaveRole: partial(
    "A non-string role rejects the returned promise, where Playwright throws synchronously."
  ),
  toHaveScreenshot: outOfScope(screenshotExcluded),
  toHaveText: implemented(),
  toHaveValue: implemented(),
  toHaveValues: implemented(),
  toMatchAriaSnapshot: partial(
    "Inline string form only. The options-only form, which reads a snapshot file, rejects; snapshot updates and a configured `children` default do not apply."
  ),
} as const satisfies Readonly<
  Record<AssertionName<Locator>, CompatibilityEntry>
>;

/** `expect(page)` matchers. */
export const pageAssertionLedger = {
  toHaveScreenshot: outOfScope(screenshotExcluded),
  toHaveTitle: implemented(
    "Also accepts `ignoreCase`, which Playwright's `toHaveTitle` does not."
  ),
  toHaveURL: partial(
    "String expectations are not resolved against a configured `baseURL`; this runtime has none."
  ),
  toMatchAriaSnapshot: undecided(),
} as const satisfies Readonly<Record<AssertionName<Page>, CompatibilityEntry>>;

/** The generic `expect` API and assertion families with no in-document target. */
export const genericExpectLedger = {
  "expect(value)": implemented(
    "Generic value matchers, asymmetric matchers, `.not`, `.resolves`, `.rejects` and custom messages."
  ),
  "expect.configure()": partial(
    "Supports `timeout` and `message`; `soft: true` throws because there is no test runner to report soft failures."
  ),
  "expect.extend()": implemented(),
  "expect.poll()": implemented(),
  "expect.soft()": outOfScope(
    "Throws because there is no test runner to report soft failures."
  ),
  "toPass()": implemented(),
  "API response assertions": outOfScope(
    "`toBeOK()` operates on Playwright's Node-side API response objects, which have no in-document counterpart."
  ),
  "Filesystem-backed snapshot assertions": outOfScope(
    "`toMatchSnapshot()` requires filesystem and test-runner state that is unavailable in the browser document."
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
