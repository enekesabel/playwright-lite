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

/** One member-level difference: what this package does and what Playwright does. */
export type MemberDifference = {
  readonly member: string;
  readonly lite: string;
  readonly playwright: string;
};

/**
 * One `### ` section describing a returned object; see the README template.
 * Omitted fields render nothing.
 */
export type ObjectSection = {
  readonly name: string;
  readonly reported?: string;
  readonly notReported?: string;
  readonly covers?: string;
  readonly notAvailable?: string;
  readonly members?: readonly MemberDifference[];
  readonly differences?: readonly string[];
  readonly edgeCases?: readonly string[];
};

/** One row of the README Events table. */
export type EventRow = {
  readonly events: readonly string[];
  readonly firesFor: string;
  readonly differences: string;
};

const elementHandleNote =
  "Returned `ElementHandle` methods and options differ; see [ElementHandle and JSHandle](#elementhandle-and-jshandle).";
const byValueNote =
  "Uses the pinned Playwright by-value argument and result serializers, and rejects a result nested deeper than Chromium's DevTools protocol accepts (298 serialized levels) in every browser, as Playwright does on Chromium.";
const handlePreviewNote =
  "The returned handle previews differently; see [ElementHandle and JSHandle](#elementhandle-and-jshandle).";
const listenerNote =
  "Fires only the [supported events](#events); other names never fire.";
const removalNote =
  "Only the [supported events](#events) ever fire; other names are accepted.";
const waitForEventNote =
  "Resolves only for the [supported events](#events); other names time out, or reject when the page closes.";
const networkObservationNote =
  "`fetch()` and `XMLHttpRequest` calls of the current document only; see [Request and Response](#request-and-response).";
const exposeFunctionNote =
  "`dispose()` leaves a value the page itself assigned to the property on `window`, where Playwright deletes it. Arguments and the result skip `JSON.stringify()`, so a page overriding `Array.prototype.toJSON()` does not make the call reject, as it does in Playwright.";
const exposeBindingNote =
  "Differs as `exposeFunction` does. The callback's `source` is `{ page, frame: page }`, with no `context`, since this package has no `BrowserContext`.";
const consoleMessagesNote =
  '`filter: "all"` and the default `"since-navigation"` return the same messages; see [ConsoleMessage](#consolemessage).';
const networkIdleNote =
  '`"networkidle"` resolves no sooner than 500 ms after the call, even when the document is already idle; see [Network idle](#network-idle).';

const closingLink = "see [Closing a page](#closing-a-page)";

const historyTraversalNote =
  "Needs the browser's Navigation API and rejects without it; returns no `Response`; resolves to `null` without navigating when the Navigation API does not list the adjacent entry (an entry of another origin, an entry beyond one, or any entry in an opaque-origin document such as a sandboxed frame), where Playwright navigates to it; [`networkidle`](#network-idle) resolves no sooner than 500 ms after the call, even when already idle.";

/** The Page events this package fires, in README order. */
export const events: readonly EventRow[] = [
  {
    events: ["close"],
    firesFor:
      "The first `close()` or `[Symbol.asyncDispose]()` call, once, with the `Page`.",
    differences:
      "Fires when the `Page` object is disposed, not when the document goes away: the document stays open, and `window.close()` or closing the tab fires nothing. See [Closing a page](#closing-a-page).",
  },
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

/** One Page event this package never fires, by decision. */
export type ExcludedEventRow = {
  readonly event: string;
  readonly reason: string;
};

/** The out-of-scope Page events, in README order. */
export const excludedEvents: readonly ExcludedEventRow[] = [
  {
    event: "popup",
    reason: "Another window is never a `Page` in this document.",
  },
];

/**
 * Returned objects, in README order. Each behaviour lives in one section;
 * `edgeCases` holds what a typical user of the object never runs into.
 */
export const objectSections: readonly ObjectSection[] = [
  {
    name: "ElementHandle and JSHandle",
    covers:
      "The `ElementHandle` and `JSHandle` objects this package returns, for example from `$()`, `waitForSelector()`, `evaluateHandle()` or `locator.elementHandle()`.",
    notAvailable:
      "`ElementHandle.contentFrame()`, `ownerFrame()`, `screenshot()` and `tap()`.",
    members: [
      {
        member: "`ElementHandle.click()`",
        lite: "Does not wait for navigation.",
        playwright: "Waits for a navigation the click starts.",
      },
    ],
    edgeCases: [
      "`toString()` describes the value as it was when the handle was first converted to a string.",
      "`toString()` of a handle to a `Proxy` prints the target's class name, such as `Object`, where Playwright prints `Proxy(Object)`.",
      "`ElementHandle.waitForSelector()` rejects the legacy `waitFor` and `visibility` options, which Playwright silently drops.",
    ],
  },
  {
    name: "Request and Response",
    reported:
      'The `fetch()` and `XMLHttpRequest` calls the current document makes while you are subscribed, through `page.on("request" | "response" | "requestfinished" | "requestfailed")`, `page.waitForRequest()`, `page.waitForResponse()` and `page.requests()`.',
    notReported:
      "Images, scripts, stylesheets, `navigator.sendBeacon`, `WebSocket`, `EventSource`, form submissions and navigations; calls made by another realm, an iframe or a service worker; a `fetch()` started or an `XMLHttpRequest` opened before the first subscription.",
    covers:
      "The package exports `Request` and `Response` types listing exactly the available members. Annotating with them is optional: `createPage()` returns Playwright's own `Page`, so code written against Playwright keeps type-checking.",
    notAvailable:
      "`Request.allHeaders()`, `existingResponse()`, `frame()`, `headersArray()`, `redirectedFrom()`, `redirectedTo()`, `serviceWorker()`, `sizes()` and `timing()`; `Response.allHeaders()`, `frame()`, `fromServiceWorker()`, `headersArray()`, `headerValues()`, `httpVersion()`, `securityDetails()` and `serverAddr()`. Calling one throws a `TypeError`.",
    members: [
      {
        member: "`resourceType()`",
        lite: '`"fetch"` or `"xhr"`.',
        playwright: "The browser's resource type.",
      },
      {
        member: "`isNavigationRequest()`",
        lite: "Always `false`.",
        playwright: "`true` for navigation requests.",
      },
      {
        member: "`Request.headers()`, `Request.headerValue()`",
        lite: "The headers the call set: the `Request` headers of a `fetch()`, the `setRequestHeader()` values of an `XMLHttpRequest`. `Cookie`, `Origin`, `User-Agent`, other browser-added headers and the `Content-Type` an `XMLHttpRequest` derives from its body are missing.",
        playwright: "`headerValue()` reads the headers that went on the wire.",
      },
      {
        member: "`Response.headers()`, `Response.headerValue()`",
        lite: "The headers the browser exposes to the document: never `Set-Cookie`, and for a cross-origin response only the CORS-safelisted names plus those its `Access-Control-Expose-Headers` lists.",
        playwright: "`headerValue()` reads the headers received on the wire.",
      },
      {
        member: "`postData()`, `postDataBuffer()`, `postDataJSON()`",
        lite: "Read a string, `URLSearchParams`, `ArrayBuffer` or typed-array body passed as the `fetch()` `body` option or the `send()` argument. A `Blob`, `FormData` or `ReadableStream` body, or one carried by a `Request` argument to `fetch()`, reports `null`.",
        playwright: "Read the body the browser sent.",
      },
      {
        member: "`postDataBuffer()`, `Response.body()`",
        lite: "`Uint8Array`.",
        playwright: "Node.js `Buffer`.",
      },
      {
        member: "`failure().errorText`",
        lite: "The name and message of the error `fetch()` rejected with, or its `AbortSignal`'s reason; for an `XMLHttpRequest`, `XMLHttpRequest:` plus the event that ended it: `error`, `timeout` or `abort`.",
        playwright: "The browser's `net::ERR_*` code.",
      },
    ],
    differences: [
      "A redirect chain is one request and one response: the request reports the URL the document asked for, the response the final URL, and no event fires per hop.",
    ],
    edgeCases: [
      "An `XMLHttpRequest` opened again while in flight reports `failure().errorText` as `XMLHttpRequest: abort`.",
      "`body()`, `text()` and `json()` of an `XMLHttpRequest` with the default `responseType` return the body re-encoded as UTF-8, so a binary or non-UTF-8 body does not come back byte for byte; Playwright returns the bytes received.",
      '`body()`, `text()` and `json()` of an `XMLHttpRequest` reject when it set `responseType` to `"json"` or `"document"`.',
      "`Response.finished()` resolves once the response body has ended. A `fetch()` response's `body()`, `text()` and `json()` still answer after the page consumed the body.",
    ],
  },
  {
    name: "Dialog",
    covers:
      '`page.on("dialog")` reports the `window.alert()`, `window.confirm()` and `window.prompt()` calls the current document makes, wrapped as Playwright\'s `Dialog`. The package exports a `Dialog` type listing exactly its members.',
    members: [
      {
        member: "`accept()`, `dismiss()`",
        lite: "Decide the result only when called synchronously in a `dialog` listener, because `alert()`, `confirm()` and `prompt()` block the page's script until they return.",
        playwright: "Settle the dialog whenever they are called.",
      },
    ],
    differences: [
      "A dialog no listener settles synchronously is dismissed once every listener has run: `alert()` returns `undefined`, `confirm()` `false`, `prompt()` `null`. Playwright auto-dismisses only when the page has no `dialog` listener.",
      "With no `dialog` listener, the browser shows its own dialog and the page waits for a person, where Playwright dismisses it.",
      'A dialog from `waitForEvent("dialog")` is already dismissed when the promise resolves, so `(await page.waitForEvent("dialog")).accept()` rejects.',
      "`beforeunload` dialogs are never reported.",
    ],
    edgeCases: [
      "Pages sharing one window share one dialog settlement: the first `accept()` or `dismiss()` call from any of them wins, and a later one rejects.",
    ],
  },
  {
    name: "ConsoleMessage",
    covers:
      "`page.on(\"console\")` and `page.consoleMessages()` report the document's own `console.log()`, `debug()`, `info()`, `error()`, `warn()`, `dir()`, `dirxml()`, `table()`, `trace()`, `clear()`, `group()`, `groupCollapsed()`, `groupEnd()`, `assert()`, `profile()`, `profileEnd()`, `count()`, `timeEnd()` and `timeLog()` calls, wrapped as Playwright's `ConsoleMessage`.",
    members: [
      {
        member: "`text()` of `count()`, `timeEnd()`, `timeLog()`",
        lite: "The label the call passed.",
        playwright: "Includes the count or elapsed time the browser computes.",
      },
      {
        member: "`page.consoleMessages()`",
        lite: 'Returns the same messages for `filter: "all"` and the default `"since-navigation"`.',
        playwright:
          '`"since-navigation"` returns only messages since the last navigation.',
      },
    ],
    differences: [
      'Only `console.*` calls made after you first subscribe with `page.on("console")` or call `page.consoleMessages()` are reported. `consoleMessages()` keeps collecting from then on, as `requests()` does.',
      "Browser-generated entries, such as a failed resource load or a Content-Security-Policy violation report, are never reported, because they never call a `console.*` method.",
    ],
    edgeCases: [
      "`text()` previews objects and arrays one level deep, each entry rendered like a `JSHandle` preview, with no truncation and no sparse-array markers. A class instance passed directly lists its own members (`{a: 1}`) where Playwright prints its constructor name (`Foo`).",
      "Building a `text()` preview never calls the page's getters, but it runs a `Proxy` argument's traps, which the browser's own preview never does. A trap that throws previews that argument as `Object`; a revoked `Proxy` argument stops the message from being reported, while the `console.*` call itself behaves as it does unobserved.",
      "`location()` is best-effort and can be off by a frame.",
      "While a `console.*` method is wrapped, stacks the browser captures gain a frame inside this package, including DevTools' call-site link for a logged message and the stack `console.trace()` prints.",
      "A `console.*` call made inside a `console` listener is forwarded to the console but fires no further `console` event, so a listener that logs cannot trigger itself.",
    ],
  },
];

export const pageLedger = {
  [Symbol.asyncDispose]: partial(
    `Closes as \`close()\` does, disposing only the \`Page\` object; ${closingLink}.`
  ),
  $: partial(elementHandleNote),
  $$: partial(elementHandleNote),
  $$eval: implemented(byValueNote),
  $eval: implemented(byValueNote),
  addInitScript: outOfScope(
    "Registers a script to run before the document's own scripts, which have already run by the time this adapter attaches."
  ),
  addListener: partial(listenerNote),
  addLocatorHandler: partial(
    "A handler that throws or rejects is logged instead of raised; see [Events](#events)."
  ),
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
  close: partial(
    `Disposes the \`Page\` object, not the document, and rejects \`runBeforeUnload: true\`; ${closingLink}.`
  ),
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
  emulateMedia: outOfScope(
    "A document cannot change its own media type or `prefers-color-scheme`."
  ),
  evaluate: implemented(byValueNote),
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
  goBack: partial(historyTraversalNote),
  goForward: partial(historyTraversalNote),
  goto: partial(
    "Returns no `Response` (`null` only for same-document hash navigation); relative URLs resolve against `document.baseURI`, with no `baseURL`; rejects `referer` and `signal`; [`networkidle`](#network-idle) resolves no sooner than 500 ms after the call, even when already idle."
  ),
  hideHighlight: implemented("Clears highlights in the current document."),
  hover: implemented(),
  innerHTML: implemented(),
  innerText: implemented(),
  inputValue: implemented(),
  isChecked: implemented(),
  isClosed: partial(
    `Reports whether this \`Page\` object was closed; the document stays open; ${closingLink}.`
  ),
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
  reload: partial(
    "Does not resolve in the old document, which the reload destroys, and returns no `Response`, since the reload [ends execution](#runtime-boundaries); rejects with a timeout only if the document is not replaced."
  ),
  removeAllListeners: partial(removalNote),
  removeListener: partial(removalNote),
  removeLocatorHandler: implemented(),
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
    "Accepts only in-memory `{ name, mimeType, buffer }` objects; file paths and directory uploads are unsupported."
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
  viewportSize: partial(
    "Returns the window's current `innerWidth` and `innerHeight`, never `null`, where Playwright returns the configured viewport or `null` without one."
  ),
  waitForEvent: partial(waitForEventNote),
  waitForFunction: partial(handlePreviewNote),
  waitForLoadState: partial(networkIdleNote),
  waitForNavigation: partial(
    "Returns `null`, never a `Response`: only same-document URL changes resolve it, observed like [`framenavigated`](#events), so a `pushState` or `replaceState` to the current URL is not seen; a cancelled navigation, such as a `204`, times out instead of rejecting; [`networkidle`](#network-idle) resolves no sooner than 500 ms after the call; its [timeout error](#navigation-timeouts) has no navigation log."
  ),
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
  description: implemented(),
  dispatchEvent: implemented(),
  dragTo: undecided(),
  drop: partial(
    "Accepts only in-memory `{ name, mimeType, buffer }` file payloads; file paths are unsupported."
  ),
  elementHandle: partial(elementHandleNote),
  elementHandles: partial(elementHandleNote),
  evaluate: implemented(byValueNote),
  evaluateAll: implemented(byValueNote),
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
    "Accepts only in-memory `{ name, mimeType, buffer }` objects; file paths and directory uploads are unsupported."
  ),
  tap: undecided(),
  textContent: implemented(),
  toString: implemented(),
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
