<!-- Generated from README.hbs and compatibility/api.ts. Run pnpm generate:readme. -->

# playwright-lite

Use Playwright's `Page` and `Locator` APIs in the browser document you're already in.
`playwright-lite` runs inside your application, without launching a browser or connecting to a Playwright server.

```ts
import { createPage } from "@enekesabel/playwright-lite";

const page = createPage();

await page.getByRole("textbox", { name: "Name" }).fill("Ada");
await page.getByRole("button", { name: "Save" }).click();
```

## Runtime boundaries

- **Current document only.** No iframe traversal, `Frame`, or `FrameLocator` support.
- **Navigation ends execution.** `goto()` can start navigation, but replacing the document destroys the JavaScript context running your script. Automation cannot continue across a full-page navigation or reload.
- **Synthetic input.** Input events are not browser-trusted. Native keyboard behavior such as cursor movement, deletion, and focus traversal is not simulated.
- **No browser control.** No browser launch, browser contexts, or browser-level control over network traffic, downloads, or other tabs.
- **Content Security Policy still applies.** Evaluation callbacks need dynamic JavaScript evaluation to be allowed by the page's policy; the library does not bypass it.

## Use cases

- Automate your own application in the browser you're using.
- Let an in-app assistant inspect and interact with the page.
- Build guided onboarding and automation flows.
- Run the supported parts of existing Playwright scripts inside your application.

## Installation

To install from source, create a tarball in a repository checkout:

```sh
devbox shell
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

Then install it in your application with the matching Playwright type dependency:

```sh
pnpm add /path/to/enekesabel-playwright-lite-0.1.0.tgz @playwright/test@1.62.1
```

Installing and bundling requires Node.js 20 or newer. Playwright's Node runtime is not included in the browser bundle.

`createPage()` accepts `testIdAttribute` (default `data-testid`), `actionTimeout` (1,000 ms), and `navigationTimeout` (30,000 ms). Set a timeout to `0` to disable it. Configuration is per page; `playwright.config.ts` is not loaded.

## Compatibility

Targets Playwright **1.62.1**. Statuses describe API compatibility within the runtime boundaries above.

✅ Compatible · ⚠️ Partially compatible · ❌ Not implemented · 🚫 Intentionally excluded

### Page

| API                           | Status | Notes                                                                                                                         |
| ----------------------------- | :----: | ----------------------------------------------------------------------------------------------------------------------------- |
| `$`                           |   ⚠️   | Returns a limited ElementHandle; handle actions and evaluateHandle are not implemented.                                       |
| `$$`                          |   ⚠️   | Returns limited ElementHandles; handle actions and evaluateHandle are not implemented.                                        |
| `$$eval`                      |   ✅   |                                                                                                                               |
| `$eval`                       |   ✅   |                                                                                                                               |
| `Symbol.asyncDispose`         |   ❌   |                                                                                                                               |
| `addInitScript`               |   ❌   |                                                                                                                               |
| `addListener`                 |   ❌   |                                                                                                                               |
| `addLocatorHandler`           |   ❌   |                                                                                                                               |
| `addScriptTag`                |   ❌   |                                                                                                                               |
| `addStyleTag`                 |   ❌   |                                                                                                                               |
| `ariaSnapshot`                |   ✅   |                                                                                                                               |
| `bringToFront`                |   ❌   |                                                                                                                               |
| `cancelPickLocator`           |   ❌   |                                                                                                                               |
| `check`                       |   ⚠️   | Requires a single match. Options: timeout, noWaitAfter, position, trial only.                                                 |
| `clearConsoleMessages`        |   ❌   |                                                                                                                               |
| `clearPageErrors`             |   ❌   |                                                                                                                               |
| `click`                       |   ⚠️   | Requires a single match. Options: timeout, noWaitAfter, position, trial only.                                                 |
| `clock`                       |   ❌   |                                                                                                                               |
| `close`                       |   ❌   |                                                                                                                               |
| `consoleMessages`             |   ❌   |                                                                                                                               |
| `content`                     |   ✅   |                                                                                                                               |
| `context`                     |   ❌   |                                                                                                                               |
| `coverage`                    |   ❌   |                                                                                                                               |
| `dblclick`                    |   ⚠️   | Requires a single match. Options: timeout, noWaitAfter, position, trial only.                                                 |
| `dispatchEvent`               |   ⚠️   | Options: timeout and strict only; handle-valued eventInit is not supported.                                                   |
| `dragAndDrop`                 |   ❌   |                                                                                                                               |
| `emulateMedia`                |   ❌   |                                                                                                                               |
| `evaluate`                    |   ⚠️   | The exposeFunctions: true option is not supported.                                                                            |
| `evaluateHandle`              |   ❌   |                                                                                                                               |
| `exposeBinding`               |   ❌   |                                                                                                                               |
| `exposeFunction`              |   ❌   |                                                                                                                               |
| `fill`                        |   ⚠️   | Requires a single match. Options: timeout and noWaitAfter only.                                                               |
| `focus`                       |   ⚠️   | Requires a single match. Only the timeout option is supported.                                                                |
| `frame`                       |   🚫   | Iframe realms are outside the single-document boundary.                                                                       |
| `frameLocator`                |   🚫   | Iframe realms are outside the single-document boundary.                                                                       |
| `frames`                      |   🚫   | Iframe realms are outside the single-document boundary.                                                                       |
| `getAttribute`                |   ✅   |                                                                                                                               |
| `getByAltText`                |   ✅   |                                                                                                                               |
| `getByLabel`                  |   ✅   |                                                                                                                               |
| `getByPlaceholder`            |   ✅   |                                                                                                                               |
| `getByRole`                   |   ✅   |                                                                                                                               |
| `getByTestId`                 |   ✅   |                                                                                                                               |
| `getByText`                   |   ✅   |                                                                                                                               |
| `getByTitle`                  |   ✅   |                                                                                                                               |
| `goBack`                      |   ❌   |                                                                                                                               |
| `goForward`                   |   ❌   |                                                                                                                               |
| `goto`                        |   ⚠️   | No Response result. Options: timeout and waitUntil (commit, domcontentloaded, load) only; no referer, signal, or networkidle. |
| `hideHighlight`               |   ✅   |                                                                                                                               |
| `hover`                       |   ⚠️   | Requires a single match. Options: timeout and noWaitAfter only.                                                               |
| `innerHTML`                   |   ✅   |                                                                                                                               |
| `innerText`                   |   ✅   |                                                                                                                               |
| `inputValue`                  |   ✅   |                                                                                                                               |
| `isChecked`                   |   ✅   |                                                                                                                               |
| `isClosed`                    |   ❌   |                                                                                                                               |
| `isDisabled`                  |   ✅   |                                                                                                                               |
| `isEditable`                  |   ✅   |                                                                                                                               |
| `isEnabled`                   |   ✅   |                                                                                                                               |
| `isHidden`                    |   ✅   |                                                                                                                               |
| `isVisible`                   |   ✅   |                                                                                                                               |
| `keyboard`                    |   ✅   |                                                                                                                               |
| `localStorage`                |   ✅   |                                                                                                                               |
| `locator`                     |   ✅   |                                                                                                                               |
| `mainFrame`                   |   ⚠️   | Returns the Page facade, not a Frame.                                                                                         |
| `mouse`                       |   ❌   |                                                                                                                               |
| `off`                         |   ❌   |                                                                                                                               |
| `on`                          |   ❌   |                                                                                                                               |
| `once`                        |   ❌   |                                                                                                                               |
| `opener`                      |   ❌   |                                                                                                                               |
| `pageErrors`                  |   ❌   |                                                                                                                               |
| `pause`                       |   ❌   |                                                                                                                               |
| `pdf`                         |   ❌   |                                                                                                                               |
| `pickLocator`                 |   ❌   |                                                                                                                               |
| `prependListener`             |   ❌   |                                                                                                                               |
| `press`                       |   ⚠️   | Requires a single match. Options: timeout and noWaitAfter only; no delay or signal.                                           |
| `reload`                      |   ❌   |                                                                                                                               |
| `removeAllListeners`          |   ❌   |                                                                                                                               |
| `removeListener`              |   ❌   |                                                                                                                               |
| `removeLocatorHandler`        |   ❌   |                                                                                                                               |
| `request`                     |   ❌   |                                                                                                                               |
| `requestGC`                   |   ❌   |                                                                                                                               |
| `requests`                    |   ❌   |                                                                                                                               |
| `route`                       |   ❌   |                                                                                                                               |
| `routeFromHAR`                |   ❌   |                                                                                                                               |
| `routeWebSocket`              |   ❌   |                                                                                                                               |
| `screencast`                  |   ❌   |                                                                                                                               |
| `screenshot`                  |   ❌   |                                                                                                                               |
| `selectOption`                |   ⚠️   | Requires a single match. No ElementHandle values. Options: timeout and noWaitAfter only.                                      |
| `sessionStorage`              |   ✅   |                                                                                                                               |
| `setChecked`                  |   ⚠️   | Requires a single match. Options: timeout, noWaitAfter, position, trial only.                                                 |
| `setContent`                  |   🚫   | Document replacement is excluded.                                                                                             |
| `setDefaultNavigationTimeout` |   ✅   |                                                                                                                               |
| `setDefaultTimeout`           |   ✅   |                                                                                                                               |
| `setExtraHTTPHeaders`         |   ❌   |                                                                                                                               |
| `setInputFiles`               |   ⚠️   | In-memory payloads with a non-empty mimeType only; no paths or directories. Options: timeout, noWaitAfter, strict only.       |
| `setViewportSize`             |   🚫   | Browser viewport resizing is excluded.                                                                                        |
| `tap`                         |   ❌   |                                                                                                                               |
| `textContent`                 |   ✅   |                                                                                                                               |
| `title`                       |   ✅   |                                                                                                                               |
| `touchscreen`                 |   ❌   |                                                                                                                               |
| `type`                        |   ⚠️   | Requires a single match. Options: timeout, delay, noWaitAfter only.                                                           |
| `uncheck`                     |   ⚠️   | Requires a single match. Options: timeout, noWaitAfter, position, trial only.                                                 |
| `unroute`                     |   ❌   |                                                                                                                               |
| `unrouteAll`                  |   ❌   |                                                                                                                               |
| `url`                         |   ✅   |                                                                                                                               |
| `video`                       |   ❌   |                                                                                                                               |
| `viewportSize`                |   ❌   |                                                                                                                               |
| `waitForEvent`                |   ❌   |                                                                                                                               |
| `waitForFunction`             |   ⚠️   | No signal option. The returned handle supports jsonValue and dispose only.                                                    |
| `waitForLoadState`            |   ❌   |                                                                                                                               |
| `waitForNavigation`           |   ❌   |                                                                                                                               |
| `waitForRequest`              |   ❌   |                                                                                                                               |
| `waitForResponse`             |   ❌   |                                                                                                                               |
| `waitForSelector`             |   ⚠️   | No signal option. Returns a limited ElementHandle without handle actions or evaluateHandle.                                   |
| `waitForTimeout`              |   ✅   |                                                                                                                               |
| `waitForURL`                  |   ❌   |                                                                                                                               |
| `workers`                     |   ❌   |                                                                                                                               |

### Locator

| API                      | Status | Notes                                                                                                                         |
| ------------------------ | :----: | ----------------------------------------------------------------------------------------------------------------------------- |
| `all`                    |   ✅   |                                                                                                                               |
| `allInnerTexts`          |   ✅   |                                                                                                                               |
| `allTextContents`        |   ✅   |                                                                                                                               |
| `and`                    |   ✅   |                                                                                                                               |
| `ariaSnapshot`           |   ✅   |                                                                                                                               |
| `blur`                   |   ✅   |                                                                                                                               |
| `boundingBox`            |   ✅   |                                                                                                                               |
| `check`                  |   ⚠️   | Options: timeout, noWaitAfter, position, trial only.                                                                          |
| `clear`                  |   ⚠️   | Options: timeout and noWaitAfter only; no force or signal.                                                                    |
| `click`                  |   ⚠️   | Options: timeout, noWaitAfter, position, trial only.                                                                          |
| `contentFrame`           |   🚫   | Iframe realms are outside the single-document boundary.                                                                       |
| `count`                  |   ✅   |                                                                                                                               |
| `dblclick`               |   ⚠️   | Options: timeout, noWaitAfter, position, trial only.                                                                          |
| `describe`               |   ✅   |                                                                                                                               |
| `description`            |   ⚠️   | Empty descriptions and descriptions retained through filter() differ from Playwright.                                         |
| `dispatchEvent`          |   ⚠️   | Only the timeout option is supported; handle-valued eventInit is not supported.                                               |
| `dragTo`                 |   ❌   |                                                                                                                               |
| `drop`                   |   ❌   |                                                                                                                               |
| `elementHandle`          |   ⚠️   | Returns a limited ElementHandle; handle actions and evaluateHandle are not implemented.                                       |
| `elementHandles`         |   ⚠️   | Returns limited ElementHandles; handle actions and evaluateHandle are not implemented.                                        |
| `evaluate`               |   ⚠️   | The exposeFunctions: true option is not supported.                                                                            |
| `evaluateAll`            |   ✅   |                                                                                                                               |
| `evaluateHandle`         |   ❌   |                                                                                                                               |
| `fill`                   |   ⚠️   | Options: timeout and noWaitAfter only; no force or signal.                                                                    |
| `filter`                 |   ✅   |                                                                                                                               |
| `first`                  |   ✅   |                                                                                                                               |
| `focus`                  |   ✅   |                                                                                                                               |
| `frameLocator`           |   🚫   | Iframe realms are outside the single-document boundary.                                                                       |
| `getAttribute`           |   ✅   |                                                                                                                               |
| `getByAltText`           |   ✅   |                                                                                                                               |
| `getByLabel`             |   ✅   |                                                                                                                               |
| `getByPlaceholder`       |   ✅   |                                                                                                                               |
| `getByRole`              |   ✅   |                                                                                                                               |
| `getByTestId`            |   ✅   |                                                                                                                               |
| `getByText`              |   ✅   |                                                                                                                               |
| `getByTitle`             |   ✅   |                                                                                                                               |
| `hideHighlight`          |   ✅   |                                                                                                                               |
| `highlight`              |   ✅   |                                                                                                                               |
| `hover`                  |   ⚠️   | Options: timeout and noWaitAfter only.                                                                                        |
| `innerHTML`              |   ✅   |                                                                                                                               |
| `innerText`              |   ✅   |                                                                                                                               |
| `inputValue`             |   ✅   |                                                                                                                               |
| `isChecked`              |   ✅   |                                                                                                                               |
| `isDisabled`             |   ✅   |                                                                                                                               |
| `isEditable`             |   ✅   |                                                                                                                               |
| `isEnabled`              |   ✅   |                                                                                                                               |
| `isHidden`               |   ✅   |                                                                                                                               |
| `isVisible`              |   ✅   |                                                                                                                               |
| `last`                   |   ✅   |                                                                                                                               |
| `locator`                |   ✅   |                                                                                                                               |
| `normalize`              |   ❌   |                                                                                                                               |
| `nth`                    |   ✅   |                                                                                                                               |
| `or`                     |   ✅   |                                                                                                                               |
| `page`                   |   ✅   |                                                                                                                               |
| `press`                  |   ⚠️   | Options: timeout and noWaitAfter only; no delay or signal.                                                                    |
| `pressSequentially`      |   ⚠️   | The signal option is not supported.                                                                                           |
| `screenshot`             |   ❌   |                                                                                                                               |
| `scrollIntoViewIfNeeded` |   ⚠️   | The signal option is not supported.                                                                                           |
| `selectOption`           |   ⚠️   | No ElementHandle values. Options: timeout and noWaitAfter only; no force or signal.                                           |
| `selectText`             |   ⚠️   | Only the timeout option is supported; no force or signal.                                                                     |
| `setChecked`             |   ⚠️   | Options: timeout, noWaitAfter, position, trial only.                                                                          |
| `setInputFiles`          |   ⚠️   | In-memory payloads with a non-empty mimeType only; no paths or directories. Options: timeout and noWaitAfter only; no signal. |
| `tap`                    |   ❌   |                                                                                                                               |
| `textContent`            |   ✅   |                                                                                                                               |
| `toString`               |   ⚠️   | Uses construction labels rather than Playwright's normalized selector descriptions.                                           |
| `type`                   |   ⚠️   | The signal option is not supported.                                                                                           |
| `uncheck`                |   ⚠️   | Options: timeout, noWaitAfter, position, trial only.                                                                          |
| `waitFor`                |   ⚠️   | The signal option is not supported.                                                                                           |
| `waitForFunction`        |   ❌   |                                                                                                                               |

## License

MIT for this project. Bundled and copied third-party code retains its own license. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and [LICENSES](LICENSES).
