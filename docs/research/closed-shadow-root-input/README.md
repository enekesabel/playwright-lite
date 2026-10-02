# Input into closed shadow roots (#259)

Investigation for [#259](https://github.com/enekesabel/playwright-lite/issues/259).
Everything here is a **feasibility observation**: no baseline entry, ledger row
or production code changes. The prototype is a throwaway patch.

## Files

- `probe.mjs` runs the same scenarios with native Playwright and with a
  playwright-lite build loaded into the page, and prints what every element
  received.
- `prototype.patch` is the throwaway prototype (an `attachShadow` hook plus
  roots learned from action targets). It applies to `main` at `3afa15b`.
- `results-current.json` and `results-prototype.json` are the probe's output
  against `main` and against the prototype.

```sh
pnpm build
node docs/research/closed-shadow-root-input/probe.mjs            # current build
git apply docs/research/closed-shadow-root-input/prototype.patch && pnpm build
node docs/research/closed-shadow-root-input/probe.mjs            # prototype
git apply -R docs/research/closed-shadow-root-input/prototype.patch
```

Set `PROBE_CHROMIUM=/path/to/chrome` when the pinned browser is not installed.
The recorded results ran on Chromium 141.0.7390.37 (not the pinned
Playwright 1.62.1 browser) under Node 22 outside Devbox, which was unavailable
in the investigating environment.

## What Playwright does

Playwright cannot locate inside closed roots (pinned
[`docs/src/locators.md`](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/docs/src/locators.md),
and `selectorEvaluator.ts` only follows `element.shadowRoot`), but its input
goes through CDP (`crInput.ts`), so Chromium hit-tests and routes keys into
closed roots. Its hit-target check climbs from the target upwards "to make it
work with closed shadow roots" (pinned `injectedScript.ts` `expectHitTarget`),
so an element that a custom selector engine or `evaluateHandle` reaches inside
a closed root is actionable, and `locator("#host").click()` lands on whatever
inner element is under the host's centre. Page state stays at the host:
`document.activeElement` is the host, and `toBeFocused()` on the host passes
while focus is inside (`_activelyFocused` compares `getRootNode().activeElement`).

## Observed: native vs current adapter vs prototype

Fixture: a closed root with a button, an input and a nested closed root. The
probe keeps the roots only to observe and to register a test selector engine.

| Step                                                 | Native Playwright                           | `main`                         | Prototype, loaded before the page's scripts |
| ---------------------------------------------------- | ------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `mouse.click` on inner button                        | inside + host                               | host only                      | same as native                              |
| `mouse.click` on inner input, `keyboard.type("abc")` | input gets key/beforeinput/input, value set | keydown on `body`, value empty | same as native                              |
| `expect(locator("#host")).toBeFocused()` after that  | passes                                      | fails                          | passes                                      |
| `locator("#host").click()` (centre is the input)     | inner input                                 | host only                      | same as native                              |
| `mouse.click` on button in nested closed root        | nested + root + host                        | host only                      | same as native                              |
| `mouse.click` outside                                | focusout through both roots                 | no focus to move               | same as native                              |
| `locator`/`getByRole`/`ariaSnapshot`                 | inner content invisible                     | invisible                      | invisible (unchanged)                       |

Event targets and `composedPath()` seen from outside listeners match native
exactly (retargeting is free because the adapter dispatches composed DOM
events on the real inner element), including the trimmed paths of
focusin/focusout that stay within one root.

**Action on an element a custom selector engine finds inside the root** (how
Ayme tests its Inspector):

| Step                                               | Native             | `main`                                          | Prototype (hook missed the root) |
| -------------------------------------------------- | ------------------ | ----------------------------------------------- | -------------------------------- |
| `locator("fixture=#inner").click()`                | inner button       | actionability passes, events go to the **host** | inner button                     |
| `locator("fixture=#field").pressSequentially("z")` | input gets the key | keydown on the host, no text                    | input gets the key               |

So on `main` the adapter already acts on elements inside closed roots when a
consumer hands it one, but dispatches the input to the wrong element.

Differences that remain in the prototype are existing synthetic-input
boundaries, not closed-root ones: a click does not move the caret (native
typed `d` at the caret's click position), `Backspace` deletes nothing, and
`fill()` dispatches no `beforeinput` (the last one also happens on a plain
input).

Vitest contract and unit suite (`vitest run`): 910/910 on `main` and 910/910 with the prototype
applied (same Chromium 141).

## Which roots an `attachShadow` hook can capture

Each closed host holds a button; a click shows whether input reached it.

| Root                                                                         | Native | Hook loaded after the page | Hook loaded before page scripts |
| ---------------------------------------------------------------------------- | ------ | -------------------------- | ------------------------------- |
| Attached by a page script during parsing                                     | ✓      | ✗                          | ✓                               |
| Attached after load                                                          | ✓      | ✓                          | ✓                               |
| Declarative `<template shadowrootmode="closed">`                             | ✓      | ✗                          | ✗                               |
| Declarative, then hydrated by `attachShadow()` (returns the same root)       | ✓      | ✗                          | ✓                               |
| Declarative on a custom element that holds `ElementInternals`                | ✓      | ✗                          | ✗                               |
| `attachShadow` called through another same-origin realm's prototype (iframe) | ✓      | ✗                          | ✗                               |
| Attached from an isolated world (extension content script)                   | ✓      | ✗                          | ✗                               |
| `Element.prototype` frozen before the hook loads                             | ✓      | ✗                          | ✗ (hook silently absent)        |

Spec backing: the HTML parser attaches declarative roots with the internal
algorithm, never through `Element.prototype.attachShadow`
([HTML](https://github.com/whatwg/html/blob/6992cb519a02db34f653ddd54c50fad2565285f5/source));
a later `attachShadow()` with the same mode empties and returns that root
([DOM](https://github.com/whatwg/dom/blob/b2e32dc730eb0dc0cce1a431393fe4a17fda1d54/dom.bs)).
`ElementInternals.shadowRoot` exposes a declarative closed root to its own
element only, so hooking `attachInternals` would add custom elements that call
it after the hook; not prototyped.

**Missed roots cannot be detected.** `attachShadow({ mode: "bogus" })` throws
`TypeError` from argument conversion on a closed host and on a plain element
alike, `shadowRoot` is `null` for both, and the one other signal,
`getHTML({ serializableShadowRoots: true })`, covers only roots declared
serializable. A `createPage()` warning about missed roots would be a guess.

## Hook mechanics

- **Timing.** A hook only sees `attachShadow` calls made after it is
  installed, so it must run before the page's scripts: an injected
  `document_start` script, `addInitScript`, or a first `<script>` in `<head>`.
  A bundle imported later, a bookmarklet, or a console paste misses every root
  created at load, which is when most widgets attach.
- **Lifetime.** Roots attached while the hook is absent are lost for good, so
  it cannot follow #118's rule (installed on subscription, restored on
  dispose). It has to be permanent from module evaluation.
- **Coexistence.** A page wrapper installed after the hook chains through it
  (captured, native called once). Two runtime copies each wrap once and both
  work. A frozen prototype leaves the hook absent without error. The Proxy
  keeps `toString()` native-looking.
- **Privacy.** The prototype keeps roots in a module-private `WeakMap`. A
  global registry (for example `Symbol.for`) would let copies share roots but
  would also hand closed roots to page code, so it is ruled out; each copy
  needs its own early hook.
- **Learned roots** need none of this: when an action's target element sits
  inside closed roots, walking `getRootNode()` from it reaches each root. The
  prototype remembers them, so a later `page.keyboard` or `page.mouse` call
  reaches the same root. Natively every root is reachable from the start, so
  remembering makes coordinate input depend on earlier actions.

## Prior art

| Tool                       | Closed roots                                                                                                                                                                           | Source                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright                 | Locators: unsupported. Input: real CDP input, so it lands inside. Issue "Allow forcing open closed shadow DOM roots" is open; its workaround is an init script forcing `mode: "open"`. | [locators.md](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/docs/src/locators.md), [crInput.ts](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/chromium/crInput.ts), [#23047](https://github.com/microsoft/playwright/issues/23047) |
| Patchright                 | Locates in closed roots from the driver via CDP `DOM.describeNode` with `pierce: true`, not from page JS.                                                                              | [framesPatch.ts](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/blob/406b3b0b2f237f1ff5ca7aea693c07174124064e/driver_patches/framesPatch.ts)                                                                                                                                                                                                       |
| Cypress                    | `.shadow()` and `includeShadowDom` read `node.shadowRoot`: closed roots invisible; events synthesized in JS, so no input path either.                                                  | [shadow.ts](https://github.com/cypress-io/cypress/blob/50c87b0fde622fe2636b3e8867feae4ce5bfca4a/packages/driver/src/dom/elements/shadow.ts)                                                                                                                                                                                                            |
| WebdriverIO v9             | Claims closed roots. A preload script wraps `attachShadow` only to log the host; the root itself comes from WebDriver BiDi node serialization.                                         | [customElement.ts](https://github.com/webdriverio/webdriverio/blob/dbf0f497130676040ce4212d9cf6459adfe16c42/packages/webdriverio/src/scripts/customElement.ts), [shadowRoot.ts](https://github.com/webdriverio/webdriverio/blob/dbf0f497130676040ce4212d9cf6459adfe16c42/packages/webdriverio/src/session/shadowRoot.ts)                               |
| Puppeteer                  | `pierce/` and `>>>` only follow open roots; CDP could pierce but these selectors don't.                                                                                                | [util.ts](https://github.com/puppeteer/puppeteer/blob/2e45a3af4323/packages/puppeteer-core/src/injected/util.ts)                                                                                                                                                                                                                                       |
| WebDriver / ChromeDriver   | "Get Element Shadow Root" has no mode check; ChromeDriver returns closed roots (reported since Chrome 131).                                                                            | [spec](https://github.com/w3c/webdriver/blob/2adf728258de/index.html), [element_commands.cc](https://github.com/chromium/chromium/blob/16c65df54ea445dc78106a0b45e3176713721c68/chrome/test/chromedriver/element_commands.cc), [selenium#14631](https://github.com/SeleniumHQ/selenium/issues/14631)                                                   |
| shadow-dom-testing-library | Explicitly skips closed roots.                                                                                                                                                         | [deep-query-selectors.ts](https://github.com/KonnorRogers/shadow-dom-testing-library/blob/db15a62e0f12f9a42bc39502c728715e389e8110/src/deep-query-selectors.ts)                                                                                                                                                                                        |
| rrweb                      | Wraps `attachShadow` but reads `.shadowRoot` afterwards, so closed roots are not recorded.                                                                                             | [shadow-dom-manager.ts](https://github.com/rrweb-io/rrweb/blob/5b08843faf9cb21c836613489ffd93d455f38181/packages/rrweb/src/record/shadow-dom-manager.ts)                                                                                                                                                                                               |
| Extensions                 | `chrome.dom.openOrClosedShadowRoot` (Chrome, Safari) and Firefox's `openOrClosedShadowRoot` are extension/privileged only.                                                             | [dom.json](https://github.com/chromium/chromium/blob/16c65df54ea445dc78106a0b45e3176713721c68/extensions/common/api/dom.json), [Element.webidl](https://github.com/mozilla-firefox/firefox/blob/b104f902c0fe268a8b0e1ca055716c52fcf9a8d1/dom/webidl/Element.webidl)                                                                                    |

No surveyed in-page tool keeps closed roots from page JavaScript; the tools
that reach them use a privileged channel (CDP, BiDi, extension APIs).
[whatwg/dom#1290](https://github.com/whatwg/dom/issues/1290) asked for a test
hook and calls overriding `attachShadow` brittle; it was closed as not
planned. Forcing roots open is ruled out: it changes what the page sees and
throws when a declarative closed root is re-attached as open.

## Options

**A. Keep the boundary.** README already says closed-root elements receive
nothing. Also leaves the bug where an action on an element inside a closed
root (custom engine, handle) passes actionability but fires on the host.

**B. Learned roots (recommended).** When an action's target element is inside
closed roots, record them from `getRootNode()` and let hit-testing and
keyboard focus descend through recorded roots. No global patching, no new
option, no #118 change; locators and snapshots are untouched. Covers Ayme's
Inspector, which it reaches through a custom selector engine. Difference from
Playwright that the ledger would state: a closed root becomes reachable for
coordinate and keyboard input only once an action has targeted an element
inside it, where Playwright reaches every root always. Remembering is needed
for click-then-type; the alternative, descending only during the action that
targets the element, breaks `locator.click()` followed by `page.keyboard`.

**C. B plus an early `attachShadow` hook.** Also covers script-created roots
of third-party widgets, but only when playwright-lite is evaluated before the
page's scripts, and never declarative-only roots, other realms or isolated
worlds. Needs a maintainer decision to amend #118's clause (a permanent
wrapper, never restored), and a choice between always installing it on import
and a separate side-effect entry point consumers import first (a new package
export, not a `createPage` option).

Not proposed: a `createPage` option or API to pass roots in (B covers the
consumer that owns its root without new API), and any exposure to locators or
ARIA snapshots.

## Follow-up acceptance criteria for B

- An action on an element inside one or more closed roots (reached through a
  custom selector engine or a handle) dispatches pointer events to that element
  and keyboard input to the element focused inside the root, with outside
  listeners seeing the host, as Playwright does.
- Once an action has targeted inside a closed root, later `page.mouse`,
  `page.keyboard`, `page.touchscreen` and drag input reach elements in that
  root; nested learned roots too.
- `mouseFocusable` reads `delegatesFocus` from a learned closed root.
- To check in the follow-up, not probed here: whether a file input inside a
  learned closed root opens a `filechooser` (`fileChooser.ts` reads the
  retargeted `composedPath()[0]`).
- Locators, `getByRole`, `ariaSnapshot()`, `toBeFocused()` and `evaluate`
  results are unchanged, asserted by contract tests.
- README: the closed-root mouse edge case states what is reached and what is
  not, once.
