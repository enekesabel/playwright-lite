# Incomplete API priorities

Research for [Which incomplete APIs matter most to playwright-lite consumers?](https://github.com/enekesabel/playwright-lite/issues/103), against Playwright 1.62.1 and its pinned source commit `26a9e470a7b3c7822084b09fb7f13902c5f37b51`.

## Verdict

Build public `expect` first. Decide the honest current-document contract for navigation observation next, because that decision affects `waitForURL`, `waitForLoadState`, and `expect(page).toHaveURL`. After those, treat Page events as separate event families rather than one feature: console and page errors are substantially more faithful than passive network observation. Small partial-API fixes are worthwhile maintenance but not a product direction. Do not prioritize synthetic pointer input or call DOM rendering Playwright screenshots.

| Rank | Candidate                        | Consumer signal                   | Current-document fidelity                                                                                    | Upstream proof                                                                                    | APIs affected                                                                                                            | Recommendation                                                                                           |
| ---: | -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
|    1 | Public `expect`                  | Very high                         | High for Locator and generic assertions; medium for Page URL assertions                                      | Strong for the existing Locator hook, but the public export still needs harness routing           | Adds the main assertion API over many existing operations                                                                | Move to a spec after the navigation-observation decision                                                 |
|    2 | Navigation observation           | High                              | High for observing the current document and same-document URL changes; impossible after document replacement | Mixed: `waitForURL` is borderline; most load-state/history specs cross documents                  | Enables three Page members and `expect(page).toHaveURL`; clarifies action navigation notes                               | Resolve the contract next                                                                                |
|    3 | Page events                      | Medium-high                       | High for `pageerror`; conditional for console; low-to-medium for network without interception                | Event-specific corpus work exists, but passive network semantics depend on browser-process events | One event-emitter seam supports `on`, `once`, `off`, `waitForEvent`, retained errors/messages, and future event families | Split by event family; do console/page errors before network observation                                 |
|    4 | Remaining partial APIs           | Mixed, generally lower            | Several small gaps are fully fixable; filesystem, other-realm, and navigation gaps are not                   | Good for several existing members                                                                 | Mostly isolated, except file payload normalization and handle behavior                                                   | Take precise hygiene tickets, not a broad feature batch                                                  |
|    5 | Screenshots                      | High                              | Low for Playwright semantics                                                                                 | The implementation and tests require browser pixel capture                                        | Would also unblock `toHaveScreenshot`                                                                                    | Exclude Playwright screenshot semantics; consider DOM capture only as a separately named product feature |
|    6 | Synthetic mouse, touch, and drag | Low; drag and touch are long-tail | Intentionally partial: untrusted events cannot reproduce native hover, scroll, or HTML drag                  | Weak for pointer input and drag                                                                   | Covers `Mouse`, `Touchscreen`, `tap`, `dragTo`, and `dragAndDrop`, but all share the same fidelity ceiling               | Keep behind the higher-ranked work                                                                       |

The ranking weighs consumer demand, honest fidelity, proof, and the number of APIs affected. It does not rank by upstream test count alone.

## Evidence and reasoning

### 1. Public `expect`

The demand signal is the clearest of the candidates. GitHub code-search proxies for individual locator matchers all exceed the navigation and input methods below: `toBeVisible` indexed at 759,808, `toHaveCount` at 301,056, `toHaveURL` at 225,280, and `toHaveText` at 167,168. These numbers are ordinal signals, not literal call or repository counts; the limitations are described under [Usage proxy](#usage-proxy).

The runtime already has the browser-side matcher engine. The current implementation exposes `Locator._expect`, and the reviewed baseline contains 39 entries that execute it. Playwright's matcher layer delegates each locator assertion to `_expect`; title and URL assertions use the corresponding frame expectation paths ([pinned matchers source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright/src/matchers/matchers.ts#L69-L464)). The public matcher object is composed above that layer ([pinned expect source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright/src/matchers/expect.ts#L180-L206), [export](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright/src/matchers/expect.ts#L463)).

The probe found 75 of 86 `expect-boolean` tests, all 15 accessible-name/error tests, all 28 text tests, all 11 value tests, and all 14 snapshot tests reachable. Many already passed through the private hook. The 278 passing generic matcher tests do not exercise the adapter, so they are evidence for the generic matcher layer only, not for browser compatibility. The detailed classification is in the [probe report](https://github.com/enekesabel/playwright-lite/blob/probe/upstream-specs/probe/summary.md), and the reviewed private-hook evidence is in the current [baseline](../../tests/upstream/baseline.json).

The product decision is already made: export near-full in-browser `expect`, with Playwright-compatible messages and every supportable Locator/Page assertion except `toHaveScreenshot` until screenshots exist ([What is the public expect's surface?](https://github.com/enekesabel/playwright-lite/issues/43#issuecomment-5719210083)). This research therefore does not propose another API decision. The remaining planning dependency is the contract for `expect(page).toHaveURL`, which is navigation observation.

### 2. Navigation observation

`waitForURL` and `waitForLoadState` have strong usage signals: 100,864 and 142,848 in the GitHub proxy. Public examples use `waitForURL` after user actions or to observe an authentication redirect ([Grafana SQLite datasource](https://github.com/fr-ser/grafana-sqlite-datasource/blob/c897040fa46b01563e243960d51e31b5aad8d229/e2e/helpers.ts#L13-L14), [Supaship](https://github.com/fireship-io/supaship.io/blob/b969117bb3dc067791b6759e11e85ab908a25115/e2e/utils.ts#L87-L89)). That maps directly to the package's in-app automation use cases.

Playwright implements both methods over frame lifecycle and navigation events. `waitForURL` first checks the current URL and either waits for a lifecycle state or delegates to `waitForNavigation`; `waitForLoadState` waits for a frame load-state event ([pinned Frame source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/frame.ts#L142-L202)). In playwright-lite, polling `window.location.href`, listening for `hashchange`/`popstate`, and reading `document.readyState` can faithfully observe the current document without patching host globals. They cannot continue after the document is replaced because the adapter's own JavaScript context is destroyed; that is an accepted [runtime boundary](../../README.md#runtime-boundaries).

The upstream corpus cannot by itself prove the full current-document contract. The probe classified 6 of 10 `Page.waitForURL` assertions as reachable, but only 4 of 18 `Page.waitForLoadState` assertions; most history, reload, and load-state specs navigate across documents ([probe report](https://github.com/enekesabel/playwright-lite/blob/probe/upstream-specs/probe/summary.md)). The current ADR allows contract tests for behavior that upstream cannot reach, but the map has not decided whether contract-test-only proof is sufficient for these rows ([compatibility evidence ADR](../adr/0002-prove-compatibility-with-the-upstream-corpus.md)).

The next decision should specify:

- which same-document URL transitions count (`hashchange`, `popstate`, `pushState`, and `replaceState` can all be observed by polling without modifying the host application);
- whether an already-reached `load` or `domcontentloaded` state resolves immediately;
- which `waitUntil` values are honest (`networkidle` is not, absent network control);
- how calls fail when full navigation starts and destroys execution;
- whether reviewed contract tests can complement the reachable upstream cases.

This one decision covers `waitForURL`, `waitForLoadState`, the surviving same-document portion of `waitForNavigation`, and `expect(page).toHaveURL`. It also gives one vocabulary for the existing `click`/`goto` navigation limitations.

### 3. Page events, including passive network observation

Events are not one fidelity class.

`pageerror` and unhandled rejection observation can use native Window error events without intercepting application behavior. Console events and retained `consoleMessages()` require observing calls that have no independent DOM event, so complete coverage normally means wrapping console methods. The current ledger plans `on`/`once`/`off`/`waitForEvent` only for console and page errors while leaving the event mechanism open ([compatibility ledger](../../compatibility/api.ts)). A shared event emitter would support listener aliases, one-shot waiting, removal, and retained message/error APIs.

Passive network observation is less faithful. In Playwright, `waitForRequest` and `waitForResponse` wait on Page `Request` and `Response` events emitted from the browser transport ([pinned Page source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/page.ts#L471-L513)). A current document can see completed resource timing entries, but that is not the same contract: it is late, omits requests that never yield an entry, and cross-origin timing details may be restricted. Intercepting `fetch`, XHR, or WebSocket would also miss browser-initiated resources and would violate the accepted no-host-global-patching boundary. The runtime-boundary decision therefore correctly leaves passive network observation gray rather than treating it as routing ([runtime-boundary resolution](https://github.com/enekesabel/playwright-lite/issues/39#issuecomment-5741627951)).

Consumer demand is real. Proxy indices were 79,104 for `page.on` plus console, 65,024 for `pageerror`, 67,840 for request, 46,080 for response, and 6,622 for request failure. A public example listens for an authentication refresh POST ([Creative Tim UI](https://github.com/creativetimofficial/ui/blob/20eb87b1f671a2ba778b435c53249522080e8f27/e2e/helpers.ts#L40-L44)). That use case needs the request URL and method at request time, which a post-completion resource-timing entry cannot honestly promise.

Recommendation: implement no generic Page event API until its first event family is named. Console/page errors should precede passive network. Network observation needs a later decision that either finds a browser API with sufficient semantics or explicitly rejects the reduced contract. A `PerformanceObserver` approximation should not silently masquerade as Playwright `Request`/`Response` events.

### 4. Remaining partial APIs

The ledger's partial rows divide into three groups.

**Good cleanup candidates**

- `Locator.description()` and `Locator.toString()` have concrete formatting/propagation differences. The pinned implementation returns the parsed custom description or `null` and derives the string from the selector ([pinned Locator source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/locator.ts#L228-L234), [string form](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/locator.ts#L420)). Upstream `locator-convenience` tests exercise both. This is exact and low risk, but not broad consumer value.
- `ElementHandle.$({ strict: true })` and strict `waitForSelector` are current-document behavior and fit the existing selector engine. They improve consistency rather than add a new workflow.
- MIME inference for in-memory `setInputFiles` and `drop` payloads can be fixed once in payload normalization and improves Page, Locator, ElementHandle, and drop. It cannot make path uploads compatible because browser code cannot read an arbitrary filesystem path. The proxy index for `setInputFiles` was 33,024. A sampled use passes a path, which is the part that remains outside the browser boundary ([Destack](https://github.com/LiveDuo/destack/blob/94d9a7ce68d76b53f225eaa30e0ce81af1ae2dce/e2e/dev/dev.spec.ts#L41-L44)).

**Revalidate before changing**

- The ledger records a promise-truthiness difference for `Locator.waitForFunction`, while the reviewed baseline now includes all ten upstream locator tests, including the async-predicate case. That inconsistency should be audited against the pinned implementation before prioritizing a fix. `waitForFunction` is materially used (proxy index 55,680), but a sampled helper only awaits readiness and does not exercise returned handles ([Survey Creator](https://github.com/surveyjs/survey-creator/blob/b883122db15ee5bc6e4181fa6b300ffd298820f3/e2e/helper.ts#L83-L114)).
- Handle preview differences come partly from reconstructing browser-process remote-object descriptions inside the document. The baseline proves common value and object cases, but exact proxy previews are not under the adapter's control.

**Boundary-limited partials**

- path-based script/style injection and file upload need filesystem access;
- `exposeFunctions: true` needs a cross-realm callback mechanism;
- action navigation waiting cannot survive document replacement;
- `mainFrame`, returned handles, and `goto` response behavior are constrained by the single-document seam.

These should keep exact consumer notes rather than attract work whose only result is a different approximation. Small cleanup tickets are useful after the product-facing work, but grouping every partial row into one initiative would mix unrelated owners and proof.

### 5. Screenshots

Screenshot demand is high: a `page.screenshot` proxy query indexed at 77,824. Consumers use it for diagnostics as well as visual assertions; one example saves both screenshot and DOM on failure ([Thorium](https://github.com/cisagov/thorium/blob/c0876ab4b8f720d8bae93a520752a169ceff6c7c/ui/e2e/helpers.ts#L360-L375)).

The fidelity mismatch is fundamental. Playwright delegates Page and Locator screenshot calls to browser-side screenshot machinery; the server implementation computes page/element geometry, prepares all frames, controls animations and caret, and asks the browser delegate for pixels ([pinned screenshotter](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/screenshotter.ts#L201-L361), [Page client](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/page.ts#L630-L641)). Current-document JavaScript has no equivalent pixel API. DOM-to-canvas libraries re-render a document, are constrained by cross-origin resources and unsupported CSS, add a dependency, and do not produce Playwright screenshots.

Recommendation: mark Page, Locator, and ElementHandle screenshots outside Playwright compatibility. If DOM capture is valuable for in-app agents, design it as a separately named capability with its own contract. This also leaves `expect(page).toHaveScreenshot` honestly excluded rather than coupling public `expect` to an imitation.

### 6. Synthetic mouse, touch, and drag

Playwright's input clients send commands through the browser channel ([pinned Mouse and Touchscreen source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/input.ts#L51-L94)); their events are browser-trusted and trigger native hit testing, hover, scrolling, and drag behavior. playwright-lite can dispatch functional synthetic events, as it already does for keyboard input, but cannot make them trusted.

The probe makes the ceiling visible: only 6 of 16 `page-mouse` tests and 3 of 7 wheel tests were reachable. Native hover, trusted events, and scrolling account for many unreachable cases. Only 7 of 21 drag tests were reachable, and native HTML5 drag does not begin from synthetic pointer events ([probe report](https://github.com/enekesabel/playwright-lite/blob/probe/upstream-specs/probe/summary.md)).

Usage is much lower than the leading candidates: mouse click indexed at 13,984, drag at 2,380, and touchscreen tap at 1,256. A sampled mouse call clicks coordinates to test click-away behavior ([Downshift](https://github.com/downshift-js/downshift/blob/1bb8b75e506fe807a5c5201a103d1bd128e5a5e2/e2e/combobox.spec.ts#L64-L67)), which a synthetic implementation could serve. That is a legitimate partial feature, but it should not outrank APIs with both higher demand and higher fidelity.

## Usage proxy

Likely usage was estimated with GitHub's public code-search REST endpoint. Each query required same-file co-occurrence of `@playwright/test`, the API token, and `language:TypeScript`. For example:

```sh
query='"@playwright/test" "waitForURL" language:TypeScript'
gh api --method GET search/code -f q="$query" -f per_page=1 --jq '.total_count'
```

Event queries added `page.on` and the event name. A browser-visible example is [the `waitForURL` search](https://github.com/search?q=%22%40playwright%2Ftest%22+waitForURL+language%3ATypeScript&type=code).

The REST `total_count` is not a literal file or call count. Values were conspicuously quantized, while the modern GitHub UI reported only a lower-bound file count for the same query. The index is file-level and may contain forks, duplicates, tutorials, dead code, or generated code. Same-file terms do not prove a Playwright call. TypeScript-only and `@playwright/test`-only queries omit JavaScript and alternative imports. One file may match several categories. The figures are only an ordinal popularity proxy, supported by sampled public source examples. They do not measure market share or exact usage.

## Recommended next decision

Resolve **What navigation observation is honest inside one document?** next. It is the only unresolved high-value contract that affects the already-decided public `expect` API. Once that decision is recorded, the map should hand public `expect` to `/to-spec`. It should not start another broad Wayfinder round before implementation planning.
