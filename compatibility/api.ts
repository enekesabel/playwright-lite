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
  "Returned `ElementHandle` objects do not implement `contentFrame()`, `ownerFrame()`, `screenshot()`, or `tap()`. Their `$()` ignores `strict`; `click()` does not wait for navigation; `waitForSelector()` rejects `strict`. A returned `JSHandle` or `ElementHandle` builds its `toString()` preview from the referenced value inside the document instead of reading a browser-process object description: the preview describes the value as it is when the handle is first converted to a string, and a handle to a `Proxy` prints the target's class name, such as `Object`, where Playwright prints `Proxy(Object)`.";

const framenavigatedPayload =
  "`framenavigated` fires with the `Page` itself, the object `mainFrame()` returns, up to 20 ms after a same-document URL change. `pushState` and `replaceState` are sampled every 20 ms: several within one interval produce one event, and a URL that changes and changes back within one interval produces none.";
const networkEventPayload =
  "`request`, `response`, `requestfinished` and `requestfailed` fire for the `fetch()` and `XMLHttpRequest` calls the document makes while a listener is registered; see [Request and Response compatibility](#request-and-response-compatibility).";
const dialogEventPayload =
  "`dialog` fires for the `window.alert()`, `window.confirm()` and `window.prompt()` calls the document makes while a listener is registered; see [Dialog compatibility](#dialog-compatibility).";
const dialogWaitForEventPayload =
  '`dialog` fires for the `window.alert()`, `window.confirm()` and `window.prompt()` calls the document makes while a listener is registered; the dialog must still be settled synchronously in a `dialog` listener, so one resolved from `waitForEvent("dialog")` is already dismissed by the time the promise resolves; see [Dialog compatibility](#dialog-compatibility).';
const consoleEventPayload =
  "`console` fires for the document's own `console.*` calls made while a listener is registered; see [ConsoleMessage compatibility](#consolemessage-compatibility).";
const eventNames =
  "`dialog`, `framenavigated`, `pageerror`, `request`, `response`, `requestfinished`, `requestfailed`, `console`";
const eventListenerLimitations = `Events: ${eventNames}. Other event names are accepted but never fire. ${dialogEventPayload} ${framenavigatedPayload} ${networkEventPayload} ${consoleEventPayload}`;
const eventRemovalLimitations = `Events: ${eventNames}. Other event names are accepted.`;
const waitForEventLimitations = `Events: ${eventNames}. Other event names are accepted and time out. ${dialogWaitForEventPayload} ${framenavigatedPayload} ${networkEventPayload} ${consoleEventPayload}`;
const networkObservationLimitations =
  "`fetch()` and `XMLHttpRequest` calls of the current document only; see [Request and Response compatibility](#request-and-response-compatibility).";
const exposeFunctionLimitations =
  "If the Site has replaced the property, the returned `Disposable`'s `dispose()` leaves the Site's value on `window`, where Playwright deletes it. Arguments and the result never cross through `JSON.stringify()`, so a Site that overrides `Array.prototype.toJSON()` does not break the call: it resolves normally, where Playwright's wire protocol rejects with a serialization error.";
const exposeBindingLimitations = `${exposeFunctionLimitations} The callback's \`source\` argument is \`{ page, frame: page }\`; there is no \`context\`, since this package has no \`BrowserContext\`.`;
const consoleMessagesLimitations =
  '`filter: "all"` and the default `"since-navigation"` return the same messages, since nothing ever marks the buffer at a navigation; see [ConsoleMessage compatibility](#consolemessage-compatibility).';

/** Consumer-facing description of this package's `console` event and `ConsoleMessage`. */
export const consoleMessageLimitations = `\`page.on("console")\` and \`page.consoleMessages()\` report the document's own \`console.log()\`, \`debug()\`, \`info()\`, \`error()\`, \`warn()\`, \`dir()\`, \`dirxml()\`, \`table()\`, \`trace()\`, \`clear()\`, \`group()\`, \`groupCollapsed()\`, \`groupEnd()\`, \`assert()\`, \`profile()\`, \`profileEnd()\`, \`count()\`, \`timeEnd()\` and \`timeLog()\` calls, wrapped as Playwright's \`ConsoleMessage\`.

The members that do exist differ from Playwright's as follows.

- Only a \`console.*\` call made after you first read \`page.on("console")\` or call \`page.consoleMessages()\` is reported; an earlier call is never observed. \`consoleMessages()\` keeps reading calls made after that first read, the same way \`requests()\` does.
- A browser-generated console entry — a failed resource load, a Content-Security-Policy violation report — never calls a \`console.*\` method, so it is never reported.
- \`timeEnd()\`, \`timeLog()\` and \`count()\` report only the label the call passed, not the elapsed time or count the browser computes internally.
- \`ConsoleMessage.text()\`'s object and array previews list their own entries one level deep, each rendered the way this package's own \`JSHandle\` description renders it, rather than the browser's own preview algorithm: no truncation, no sparse-array markers, and a class instance passed directly as an argument lists its own members (\`{a: 1}\`) where Playwright prints its constructor name (\`Foo\`).
- Building a \`text()\` preview never calls the page's getters, but it does run a \`Proxy\` argument's traps, which the browser's own preview never does. A trap that throws leaves that argument previewed as \`Object\`, and a revoked \`Proxy\` argument stops the message from being reported; the \`console.*\` call itself returns and behaves as it does unobserved.
- \`ConsoleMessage.location()\` is reconstructed from the calling script's own stack at the point of the call, not the browser's own recorded call-site data: engine stack-formatting differences and inlining can shift or drop a frame.
- Wrapping a \`console.*\` method adds a frame of its own to any stack the browser captures while it is wrapped, including DevTools' own call-site link for a logged message and the stack \`console.trace()\` itself prints: both point partway into this package's own code, not only at the calling script.
- A \`console.*\` call made from inside a \`console\` listener is forwarded to the real method but does not itself fire another \`console\` event, so a listener that logs cannot trigger itself.`;

const networkIdleLimitations =
  '`"networkidle"` resolves no sooner than 500 ms after the call, even when the document is already idle; see [Runtime boundaries](#runtime-boundaries).';

/** Consumer-facing description of this package's `Request` and `Response`. */
export const networkLimitations = `\`page.on("request" | "response" | "requestfinished" | "requestfailed")\`, \`page.waitForRequest()\`, \`page.waitForResponse()\` and \`page.requests()\` report the \`fetch()\` and \`XMLHttpRequest\` calls the current document makes while you are subscribed. Images, scripts, stylesheets, \`navigator.sendBeacon\`, \`WebSocket\`, \`EventSource\`, form submissions and navigations are not reported, and neither are \`fetch()\` and \`XMLHttpRequest\` calls made by another realm, by an iframe or by a service worker, nor a \`fetch()\` call started or an \`XMLHttpRequest\` opened before the first subscription.

\`Request\` has \`url()\`, \`resourceType()\`, \`method()\`, \`headers()\`, \`headerValue()\`, \`postData()\`, \`postDataBuffer()\`, \`postDataJSON()\`, \`isNavigationRequest()\`, \`failure()\` and \`response()\`. \`allHeaders()\`, \`headersArray()\`, \`frame()\`, \`redirectedFrom()\`, \`redirectedTo()\`, \`serviceWorker()\`, \`sizes()\` and \`timing()\` are not implemented and throw a \`TypeError\` when called.

\`Response\` has \`url()\`, \`status()\`, \`statusText()\`, \`ok()\`, \`headers()\`, \`headerValue()\`, \`body()\`, \`text()\`, \`json()\`, \`finished()\` and \`request()\`. \`allHeaders()\`, \`headersArray()\`, \`headerValues()\`, \`frame()\`, \`fromServiceWorker()\`, \`httpVersion()\`, \`securityDetails()\` and \`serverAddr()\` are not implemented and throw a \`TypeError\` when called.

The package exports \`Request\` and \`Response\` types listing exactly the members above. Annotating a value with one of them is optional: \`createPage()\` returns Playwright's own \`Page\`, so code written against Playwright keeps type-checking here.

The members that do exist differ from Playwright's as follows.

- \`resourceType()\` is \`"fetch"\` or \`"xhr"\`, and \`isNavigationRequest()\` is always \`false\`.
- \`Request.headers()\` and \`Request.headerValue()\` report the headers the call set — the \`Request\` headers of a \`fetch()\`, the \`setRequestHeader()\` values of an \`XMLHttpRequest\` — not the headers that went on the wire: \`Cookie\`, \`Origin\`, \`User-Agent\` and the other headers the browser adds are missing, as is the \`Content-Type\` an \`XMLHttpRequest\` derives from its \`send()\` body. Playwright's \`headerValue()\` reads the wire headers.
- \`Response.headers()\` and \`Response.headerValue()\` report the headers the browser exposes to the document: \`Set-Cookie\` is never among them, and a cross-origin response exposes only the CORS-safelisted names plus the ones its \`Access-Control-Expose-Headers\` lists.
- \`postData()\`, \`postDataBuffer()\` and \`postDataJSON()\` answer without waiting, as Playwright's do, so they read the body only in the forms the call can hand over synchronously: a string, \`URLSearchParams\`, an \`ArrayBuffer\` or a typed array, passed as the \`fetch()\` \`body\` option or as the \`send()\` argument. A \`Blob\`, \`FormData\` or \`ReadableStream\` body, and a body carried by a \`Request\` argument to \`fetch()\`, can only be read asynchronously, and report \`null\`.
- \`postDataBuffer()\` returns a \`Uint8Array\` and \`Response.body()\` resolves with a \`Uint8Array\`, where Playwright returns a Node.js \`Buffer\`.
- \`failure().errorText\` is the name and message of the error the \`fetch()\` call rejected with, or the reason its \`AbortSignal\` carried. An \`XMLHttpRequest\` carries no error, so it reports \`XMLHttpRequest:\` followed by the name of the event that ended it: \`error\`, \`timeout\` or \`abort\`, which is also what an \`XMLHttpRequest\` opened again while in flight reports. Playwright reports the browser's \`net::ERR_*\` code.
- A redirect chain is one request and one response: the request reports the URL the document asked for, the response reports the final URL, and no event is emitted per hop.
- \`Response.finished()\` resolves once the response body has ended. A \`fetch()\` response body is read and buffered as the response arrives, so that \`body()\`, \`text()\` and \`json()\` can still answer after the document consumed it. An \`XMLHttpRequest\` body is read back from the request once it is done. With the default \`responseType\` the browser has already decoded that body as text, so the three return it re-encoded as UTF-8, and a binary or non-UTF-8 body does not come back byte for byte; Playwright returns the bytes received. They reject when the request set \`responseType\` to \`"json"\` or \`"document"\`, because the browser then keeps only the value it parsed.`;

/** Consumer-facing description of this package's `dialog` event and `Dialog`. */
export const dialogLimitations = `\`page.on("dialog")\` reports the \`window.alert()\`, \`window.confirm()\` and \`window.prompt()\` calls the current document makes, wrapped as Playwright's \`Dialog\`.

\`Dialog\` has \`type()\`, \`message()\`, \`defaultValue()\`, \`accept()\`, \`dismiss()\` and \`page()\`. The package exports a \`Dialog\` type listing exactly these members. \`beforeunload\` dialogs are never reported.

The members that do exist differ from Playwright's as follows.

- A dialog is settled synchronously. \`window.alert()\`, \`window.confirm()\` and \`window.prompt()\` block the document's own script until they return, so a \`dialog\` listener must call \`accept()\` or \`dismiss()\` synchronously, before returning control to the wrapped call, for that call to decide the result. Playwright itself settles a dialog whenever the listener eventually calls \`accept()\`/\`dismiss()\`, however later that is.
- If no listener settles a dialog synchronously, it is dismissed once every listener has run, and the wrapped call returns the dismissed value: \`undefined\` for \`alert()\`, \`false\` for \`confirm()\`, \`null\` for \`prompt()\`. Playwright auto-dismisses only when a page has no \`dialog\` listener at all; here the same auto-dismiss also covers a listener that does not settle the dialog in time.
- With no \`dialog\` listener, the page is left untouched: the browser shows its own dialog and the page waits for a person, where Playwright dismisses it.
- A dialog resolved from \`waitForEvent("dialog")\` is already dismissed by the time the promise resolves, so \`(await page.waitForEvent("dialog")).accept()\` rejects: a dialog can only be settled synchronously, inside a \`dialog\` listener.
- Pages sharing one window share one dialog settlement: the first \`accept()\`/\`dismiss()\` call, from any of them, wins, and a later one rejects.`;

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
  addInitScript: outOfScope(
    "Registers a script to run before the document's own scripts, which have already run by the time this adapter attaches."
  ),
  addListener: partial(eventListenerLimitations),
  addLocatorHandler: undecided(),
  addScriptTag: partial(
    "Rejects `path`, which reads the script from disk. Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  addStyleTag: partial(
    "Rejects `path`, which reads the stylesheet from disk. Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
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
  consoleMessages: partial(consoleMessagesLimitations),
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
  evaluateHandle: partial(
    "The returned handle previews differently; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  exposeBinding: partial(exposeBindingLimitations),
  exposeFunction: partial(exposeFunctionLimitations),
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
      networkIdleLimitations
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
  prependListener: partial(eventListenerLimitations),
  press: implemented(),
  reload: planned(
    "Initiates browser navigation; execution ends on document replacement."
  ),
  removeAllListeners: partial(eventRemovalLimitations),
  removeListener: partial(eventRemovalLimitations),
  removeLocatorHandler: undecided(),
  request: outOfScope(
    "Returns Playwright's Node-side API request context, which has no in-document counterpart."
  ),
  requestGC: outOfScope(
    "Forcing garbage collection requires the browser process."
  ),
  requests: partial(networkObservationLimitations),
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
  waitForEvent: partial(waitForEventLimitations),
  waitForFunction: partial(
    "The returned handle previews differently; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  waitForLoadState: partial(networkIdleLimitations),
  waitForNavigation: undecided(),
  waitForRequest: partial(networkObservationLimitations),
  waitForResponse: partial(networkObservationLimitations),
  waitForSelector: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  waitForTimeout: implemented(),
  waitForURL: partial(networkIdleLimitations),
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
  elementHandle: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  elementHandles: partial(
    "Returned `ElementHandle` methods and options differ; see [ElementHandle compatibility](#elementhandle-compatibility)."
  ),
  evaluate: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateAll: implemented(
    "Uses the pinned Playwright by-value argument and result serializers."
  ),
  evaluateHandle: partial(
    "The returned handle previews differently; see [ElementHandle compatibility](#elementhandle-compatibility)."
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
