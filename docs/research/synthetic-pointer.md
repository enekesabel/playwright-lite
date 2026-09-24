# Synthetic mouse, touch and drag inside one document

Research for [How far can synthetic mouse, touch and drag go inside one document?](https://github.com/enekesabel/playwright-lite/issues/154), against Playwright 1.62.1 at its pinned source commit `26a9e470a7b3c7822084b09fb7f13902c5f37b51`. It blocks [Do synthetic mouse, touch, tap and drag ship, and under which contract?](https://github.com/enekesabel/playwright-lite/issues/155). The demand ranking is not redone here: [Which incomplete APIs matter most to playwright-lite consumers?](https://github.com/enekesabel/playwright-lite/issues/103) put this family sixth ([report](https://github.com/enekesabel/playwright-lite/blob/5ba2ec0abfe203ffb79f9e21e07037faf51e4825/docs/research/incomplete-api-priorities.md#6-synthetic-mouse-touch-and-drag)).

The evidence is a throwaway spike on the `research/synthetic-pointer` branch, built on `main` at [`5243505`](https://github.com/enekesabel/playwright-lite/tree/524350528c1dfe8a7867663f286efbf27923f908). Nothing was promoted and `tests/upstream/baseline.json` is unchanged.

Links below use two abbreviations. **PW** is `microsoft/playwright` at the pinned commit. **Lite** is this repository at `5243505`.

## Verdict

Every member can ship as `partial`, with a one-sentence ledger note (below) whose differences can be stated precisely. No member falls into "not honest". Drag is the weakest: it works only by emulating HTML drag and drop in script.

With about 800 added lines of throwaway runtime code on the existing click/hover pipeline, the spike passes 30 of the 42 runnable tests in `page-mouse`, `wheel` and `page-drag`; `main` passes 1. It also passes 7 of 9 tests in the pinned tap spec, which becomes reachable with a one-line harness export. The spike needs no new dependency, no `createPage` option and no host-global patch. What remains out of reach is what a script cannot do: make events trusted, apply CSS `:hover`, run the browser's own default actions (text selection), and reach other realms (iframes, popups, navigation).

| Member             | Verdict           | Spike evidence (pinned upstream tests that pass through the adapter)                                                                                               |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mouse.move`       | Partial with note | Tweening, `pointerType`, event order and buttons during a drag pass; all `:hover` and iframe tests fail                                                            |
| `mouse.down`       | Partial with note | `buttons` / `event.buttons` masks and right-button `contextmenu` pass; native text selection fails                                                                 |
| `mouse.up`         | Partial with note | Click generation passes on every field except `isTrusted`                                                                                                          |
| `mouse.click`      | Partial with note | Coordinate flooring and `detail` pass; the 3 `isTrusted` assertions fail                                                                                           |
| `mouse.dblclick`   | Partial with note | `dblclick` with `detail: 2` passes except `isTrusted`                                                                                                              |
| `mouse.wheel`      | Partial with note | 6/7 pass (scrolling is emulated); popup test times out                                                                                                             |
| `touchscreen.tap`  | Partial with note | Well-formed touch points pass                                                                                                                                      |
| `Page.tap`         | Partial with note | Chromium's exact 14-event sequence, trial run, canceled `touchstart`/`touchend` and modifiers all pass                                                             |
| `Locator.tap`      | Partial with note | Runs; its only upstream test has no assertion                                                                                                                      |
| `Locator.dragTo`   | Partial with note | 3 upstream tests pass, including tweened `steps` and a destroyed source                                                                                            |
| `Page.dragAndDrop` | Partial with note | Helper, tweened `steps`, `sourcePosition`/`targetPosition` pass; `mouse`-driven drags reproduce Chromium's full event order, Escape cancel, and effect negotiation |

`Page.mouse` and `Page.touchscreen` are the properties that return these objects; they follow their members.

## 1. Pinned semantics

### How Playwright produces the events

Every client input call is a protocol command with no timeout: `Mouse.move/down/up/click/wheel`, `dblclick` as `click` with `clickCount: 2`, and `Touchscreen.tap` ([PW client/input.ts L51-94](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/input.ts#L51-L94)). The server `Mouse` keeps the state:

- the last position, starting at `(0, 0)`;
- the set of pressed buttons and the last button;
- `move` with `steps` interpolates `steps` points, the last landing exactly on the destination;
- `click` is move, then `down`/`up` for each `clickCount` (as `cc = 1..n`), with `delay` between them;
- `wheel` fires at the current position.

`Touchscreen.apiTap` throws `hasTouch must be enabled on the browser context before using the touchscreen.` unless the context has `hasTouch` ([PW server/input.ts L197-295, L357-380](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/input.ts#L197-L380)).

On Chromium those calls become `Input.dispatchMouseEvent` (`mouseMoved`/`mousePressed`/`mouseReleased` with `buttons` mask, `clickCount`, modifiers; `mouseWheel` with deltas) and `Input.dispatchTouchEvent` (`touchStart` with one point, `touchEnd`) ([PW crInput.ts L93-190](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/chromium/crInput.ts#L93-L190)). The browser then does the rest:

- hit testing;
- pointer events, followed by compatibility mouse events;
- `click`/`auxclick`/`dblclick` generation;
- `:hover`/`:active`;
- focus, text selection and context menus;
- wheel scrolling;
- turning a touch into a tap gesture with compatibility mouse events.

**Drag** starts in the browser. Before a left-button move, Playwright's Chromium `DragManager` turns on `Input.setInterceptDrags`. If the renderer fires an uncanceled `dragstart`, Playwright captures the drag data and switches to drag mode. From then on:

- moves are sent as `dragEnter`/`dragOver`;
- `mouse.up` becomes `drop`;
- a later `mouse.down` is ignored;
- `Escape` becomes `dragCancel` and the keydown is swallowed.

Sources: [PW crDragDrop.ts L31-141](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/chromium/crDragDrop.ts#L31-L141), [PW crInput.ts L56-59](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/chromium/crInput.ts#L56-L59).

**`dragAndDrop`/`dragTo`** runs two retried pointer actions ([PW frames.ts L1265-1287](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/frames.ts#L1265-L1287); [client locator.ts L127](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/locator.ts#L127), [client page.ts L715](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/client/page.ts#L715)):

1. "move and down" on the source at `sourcePosition`: visible and stable, with a `mouse` hit-target check.
2. "move and up" on the target at `targetPosition`, moving with `steps`. The hit-target check here is `drag`, which does only the preliminary `expectHitTarget` ([PW injectedScript.ts L1104-1109](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/injected/src/injectedScript.ts#L1104-L1109)).

**`tap`** is a retried pointer action. It is visible, enabled and stable, uses the `tap` hit-target interceptor (`pointerdown`, `pointerup`, `touchstart`, `touchend`, `touchcancel`; [PW injectedScript.ts L208-211](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/injected/src/injectedScript.ts#L208-L211)), then calls `touchscreen.tap`. Without `hasTouch` it throws `The page does not support tap. Use hasTouch context option to enable touch support.` ([PW frames.ts L1289-1293](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/frames.ts#L1289-L1293), [dom.ts L561-569](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/dom.ts#L561-L569)).

**Trial runs perform the input.** `_performPointerAction` calls the action even when `trial` is set ([PW dom.ts L490](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/dom.ts#L490)). In trial mode the interceptor preventDefaults and stops the events in its set ([PW injectedScript.ts L1118-1142](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/injected/src/injectedScript.ts#L1118-L1142)). That is why a trial tap still delivers `pointerover`/`pointerenter`/`pointerout`/`pointerleave` to the page.

### Observable sequences (Chromium, from the pinned tests)

- **Mouse.** Examples:
  - `click` has `detail` equal to the click count, integer `clientX`/`clientY` (fractions round down), and `isTrusted: true`.
  - Pressing middle then left gives `mousedown` `buttons` 4 then 5; releasing gives `mouseup` 1 then 0.
  - `pointerdown` for a middle click has `detail: 0`, `button: 1`, `buttons: 4`, `pointerId: 1`, and `pointerType: 'mouse'`.
  - A right-button press fires `contextmenu`.

  Sources: [PW page-mouse.spec.ts](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/page/page-mouse.spec.ts).

- **Wheel.** The `wheel` event carries `deltaX`/`deltaY` and `deltaMode: 0` at the pointer position, plus modifiers. The page scrolls unless a listener cancels the event. On macOS Chromium scales the deltas, so the spec ignores them there ([PW wheel.spec.ts L25-34](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/page/wheel.spec.ts#L25-L34)).
- **Drag.** `mousemove@120;86`, `mousedown@120;86`, then `mousemove@240;350`, then `dragstart@120;86` (the press point), then `dragenter@240;350`, with no `dragover` on that first move. `mouse.up` gives `dragover`, `drop`, `dragend`, and no `mouseup`. On Escape Chromium fires only `dragend`, and the next `mouse.up` is an ordinary `mouseup` ([PW page-drag.spec.ts L35-121](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/page/page-drag.spec.ts#L35-L121)).
- **Tap.** `pointerover`, `pointerenter`, `pointerdown`, `touchstart`, `pointerup`, `pointerout`, `pointerleave`, `touchend`, then compatibility `mouseover`, `mouseenter`, `mousemove`, `mousedown`, `mouseup`, `click`. The compatibility events are absent if `touchstart` or `touchend` was canceled. Touch points have `radiusX/Y: 1`, `force: 1`, `rotationAngle: 0`, `identifier: 0` ([PW tap.spec.ts L22-159](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/library/tap.spec.ts#L22-L159)).

### What only the browser process provides

Measured in the pinned Chromium 151 (`Chrome/151.0.7922.34`) by dispatching events from page script:

| Browser-process behaviour                                                     | Script-dispatched equivalent                                                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `isTrusted: true`, and the user activation that follows from it               | Always `false`; no user activation (popups, clipboard, fullscreen stay gated)                                                     |
| Native hit testing                                                            | `document.elementFromPoint`, recursing through open shadow roots; same-document only                                              |
| `:hover` / `:active`                                                          | Never applied; `matches(':hover')` stayed `false` after synthetic `pointerover`/`mouseover`/`mousemove`                           |
| Wheel scrolling                                                               | A synthetic `wheel` event never scrolls; the adapter must call `scrollBy` itself                                                  |
| HTML drag start                                                               | Synthetic `mousedown` + moves over a `draggable` element fired no `dragstart`, `drag`, `dragend` or `pointercancel`               |
| Drag data store modes                                                         | A constructed `DataTransfer` ignores writes to `effectAllowed` and `dropEffect` (both read `"none"`); its data is always readable |
| Default actions (text selection, context menu UI, autoscroll, drop insertion) | Not performed                                                                                                                     |
| Other realms (iframes, popups), navigation                                    | Out of reach of the current document                                                                                              |

A `MouseEvent` built with `clientX: 50.9` reports `50`, matching Chromium's rounding down; a `PointerEvent` keeps `50.9`. `Touch` and `TouchEvent` can be constructed even without `hasTouch`. With `hasTouch`, `navigator.maxTouchPoints` is `1`; without it, `0`. The `ontouchstart` property was absent in both cases.

Playwright has its own precedent for this. Its pinned WebKit **WebView** backend drives input entirely with script events through `WebViewInput`:

- `mouseMove` fires over/out/enter/leave and moves, marked `__pwTrustedSynthetic`;
- `mouseEvent` fires `mousedown`/`mouseup`/`click`;
- `wheel` dispatches and then always calls `scrollBy`;
- `tap` fires touch events and then mouse events.

Sources: [PW webViewInput.ts L114-401](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/injected/src/webview/webViewInput.ts#L114-L401), [wvInput.ts L92-164](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/webkit/webview/wvInput.ts#L92-L164). The pinned injected script accepts `__pwTrustedSynthetic` in the hit-target interceptor for that reason ([PW injectedScript.ts L1123-1127](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/injected/src/injectedScript.ts#L1123-L1127)).

Upstream's expectations file for that backend lists the same ceiling ([PW webkit-webview-page.txt](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/webview/expectations/webkit-webview-page.txt)):

- `native-drag-and-drop`: "Synthetic mouse events cannot drive WebKit's native HTML5 drag controller" (L145-149);
- `hover-state-missing` for all three `:hover` tests (L496-504);
- the three `isTrusted` click tests and `pointerType` under assertion mismatches (L300-303);
- the custom-button `pointerdown` test and mouse text selection under `misc` (L420-421).

## 2. Reuse

The runtime already has almost everything:

- **Pointer state and event synthesis.** `PageImpl` keeps `pointerPosition` (starting at the origin) and `pointerTarget` ([Lite page.ts L350-352](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L350-L352)). `movePointer` implements pinned `steps` interpolation ([L3995](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L3995-L4012)). `movePointerTo` emits out/leave/over/enter plus `pointermove`/`mousemove` ([L4014-4142](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L4014-L4142)). `dispatchClick` emits down/up, `contextmenu`, `click`/`auxclick` on the common ancestor, and `dblclick` ([L4144-4245](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L4144-L4245)). `pointerTask` runs one event per task, like `WebViewInput._postTask` ([L3971](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L3971-L3993)).
- **Hit testing and event construction.** `eventTargetAtPoint` is `elementFromPoint` through open shadow roots ([L4247-4257](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L4247-L4257)). `dispatchPointerEvent`/`dispatchMouseEvent`/`pointerEventInit` add modifiers from the keyboard state and mark `__pwTrustedSynthetic` ([L4524-4610](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L4524-L4610)).
- **Actionability.** `performPointerAction` follows pinned `dom.ts` ordering: retarget, actionability, scroll, the pinned `setupHitTargetInterceptor`, temporary modifiers, input, then interceptor cleanup ([L907](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L907-L1028)).
- **Drop.** `dropSelector`/`dispatchDrop` ([L1422-1489](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/src/page.ts#L1422-L1489)) is a copy of pinned `ElementHandle._drop`. That upstream code is itself a page-script `DataTransfer` plus `DragEvent` dispatch (`dragenter`, `dragover`, `drop` or `dragleave`) ([PW dom.ts L659-724](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/dom.ts#L659-L724)). Pinned Playwright already ships one synthetic drag path.

The spike ([`src/page.ts`](../../src/page.ts), marked `SPIKE`) adds:

- `SyntheticMouse` and `SyntheticTouchscreen` objects, plus `PageImpl.mouseMove/Down/Up/Click/Wheel`, `touchscreenTap`, `tapSelector`/`tap`, `dragAndDropSelectors`/`dragAndDrop`, and `LocatorImpl.tap`/`dragTo`;
- a pressed-button set, per-button press targets for click generation, and pointerdown-canceled suppression of mouse events;
- in `movePointerTo`, two changes: carry the `buttons` mask, and route to drag events while a drag is active;
- HTML drag emulation (below), and an `Escape` hook in the keyboard.

Everything reuses the helpers above. It adds no dependency, no `createPage` option and no host-global patch. The one object it patches is the drag `DataTransfer` the adapter creates itself.

**Drag emulation.** On `mouse.down` (left button, `mousedown` not canceled), the spike records the nearest ancestor whose `draggable` property is true.

The next move with the left button held does the following:

1. Dispatch the normal `pointermove`/`mousemove`.
2. Dispatch `dragstart` at the press point with a new `DataTransfer`.
3. If `dragstart` is not canceled: fire `pointercancel`, then `dragenter` at the current point, and enter drag mode.

In drag mode:

- a move fires `drag` on the source, fires `dragenter`/`dragleave` when the target changes, and fires `dragover`;
- `mouse.up` fires `dragover`, then `drop` if the operation is not `none`, else `dragleave`, then `dragend`;
- `Escape` fires only `dragend`, and the next `mouse.up` is an ordinary `mouseup`.

The operation follows the HTML drag-and-drop tables:

- `dropEffect` is initialised from `effectAllowed`;
- a canceled `dragover` yields `dropEffect` when `effectAllowed` permits it, otherwise `none`.

Because a constructed `DataTransfer` in Chromium drops writes to `effectAllowed`/`dropEffect`, the spike defines both as own accessors on that one instance. Without that shim no page could negotiate an effect, and a page that checks `dropEffect === 'move'` in `dragend` to remove the source would always see `none`.

**Harness changes on the spike branch.** All are transport; no result is computed:

- `page.mouse`/`page.touchscreen` proxies, gated on the ledger like `keyboard`;
- evidence instrumentation as `Mouse.*`/`Touchscreen.*`;
- a handle-returning route for `ElementHandle.evaluateHandle`, which the bridge returned by value, so `jsonValue()` was missing;
- a `contextTest` export equal to the page fixture (pinned `browserTest.ts` exports `contextTest`);
- `tap.spec.ts` copied byte-for-byte (sha256 `47b0c63f…`, verified against the pinned raw file) and registered in `corpus.ts`.

The spike ledger marks the members `partial` with a placeholder pointing here.

## 3. Empirical ceiling

Environment: macOS, Devbox, `pnpm exec playwright test tests/upstream/{page-mouse,wheel,page-drag,tap}.spec.ts`, Chromium headless. "Main" is the same run on unmodified `5243505`. Evidence is the recorded `adapter-execution` annotation: members entered in the browser adapter, native operations, and transport failures. Every spike pass below recorded the intended public member (`Mouse.*`, `Touchscreen.tap`, `Page.tap`, `Locator.tap`, `Page.dragAndDrop`, `Locator.dragTo`) with zero transport failures. Setup-only native calls are listed.

**Headline.**

| Spec                       | Main                                | Spike                      |
| -------------------------- | ----------------------------------- | -------------------------- |
| `page-mouse` (16)          | 1 pass, 15 fail                     | 7 pass, 9 fail             |
| `wheel` (7)                | 0 pass, 7 fail                      | 6 pass, 1 timeout          |
| `page-drag` (21)           | 0 pass, 19 fail, 2 upstream `fixme` | 17 pass, 2 fail, 2 `fixme` |
| `tap` (9, `tests/library`) | unreachable                         | 7 pass, 2 fail             |

- **Totals.** `page-mouse`, `wheel` and `page-drag` go from 1/42 to 30/42. The tap spec goes from unreachable to 7/9. The one pass on main is `should set modifier keys on click`, which exercises `Page.click` and not a pointer member.
- **Bridge fix.** Four drag tests (`should send the right events`, `should not send dragover on the first mousemove`, `should cancel on escape`, `should work if not doing a drag`) reached their assertions only after the bridge's `ElementHandle.evaluateHandle` fix.
- **Weak assertions.** Five passes are weak and would stay diagnostic:
  - `should not crash on mouse drag with any button` has no assertion.
  - `should dispatch mouse move after context menu was opened` only awaits a `contextmenu` promise.
  - `should work if the drag is canceled` and `what happens when dragging element is destroyed` would also pass if no drag were emulated.
  - Tap `locators › should send all of the correct events` has no assertion.

### `page-mouse.spec.ts`

| Test                                                     | Main | Spike    | Evidence (adapter members)         | Cause / note                                                                                                      |
| -------------------------------------------------------- | ---- | -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| should click the document @smoke                         | fail | fail     | `Mouse.click`                      | `isTrusted` (type, detail, coordinates pass first)                                                                |
| should dblclick the div                                  | fail | fail     | `Mouse.dblclick`                   | `isTrusted`                                                                                                       |
| down and up should generate click                        | fail | fail     | `Mouse.move/down/up`               | `isTrusted`                                                                                                       |
| should pointerdown the div with a custom button          | fail | fail     | `Mouse.click`                      | `isTrusted` (detail 0, button 1 pass first)                                                                       |
| should report correct buttons property                   | fail | **pass** | `Mouse.move/down/up`               | 4, 5, 1, 0 masks                                                                                                  |
| should report correct pointerType property               | fail | **pass** | `Mouse.move/down/up`               | Pinned WebView backend fails this one                                                                             |
| should select the text with mouse                        | fail | fail     | `Mouse.move/down/up`               | Native default action (text selection)                                                                            |
| should trigger hover state                               | fail | fail     | `Page.hover`                       | Native `:hover`                                                                                                   |
| should trigger hover state on disabled button            | fail | fail     | `Page.hover`                       | Native `:hover`                                                                                                   |
| should trigger hover state with removed window.Node      | fail | fail     | `Page.hover`                       | Fails earlier: `ReferenceError: Node is not defined` from the same-realm InjectedScript; `:hover` would fail next |
| should set modifier keys on click                        | pass | pass     | `Keyboard.down`, `Page.click`      | Not a pointer member                                                                                              |
| should tween mouse movement                              | fail | **pass** | `Mouse.move`                       | `steps` interpolation                                                                                             |
| should always round down                                 | fail | **pass** | `Mouse.click`                      | `MouseEvent` floors 50.1/50.9 to 50                                                                               |
| should not crash on mouse drag with any button           | fail | pass     | `Mouse.move/down`                  | No assertion: diagnostic                                                                                          |
| should dispatch mouse move after context menu was opened | fail | pass     | `Mouse.move/down`                  | Awaits `contextmenu` only: diagnostic                                                                             |
| should track hover across iframe boundaries              | fail | fail     | `Mouse.move`, native `Page.frames` | Other realm: the child document never receives `mouseenter`                                                       |

### `wheel.spec.ts`

On macOS the spec's own `beforeAll` sets `ignoreDelta`, so delta values were not asserted locally. The synthetic `WheelEvent` carries the requested deltas exactly. That Linux CI would pass the delta checks is an inference, not measured.

| Test                                                       | Main | Spike    | Evidence                                | Cause / note                                               |
| ---------------------------------------------------------- | ---- | -------- | --------------------------------------- | ---------------------------------------------------------- |
| should dispatch wheel events @smoke                        | fail | **pass** | `Mouse.move/wheel`, native `setContent` | Scroll is emulated (`scrollBy`)                            |
| should dispatch wheel events after popup was opened @smoke | fail | timeout  | `Mouse.move`, `Page.waitForEvent`       | Other page: `popup` never fires                            |
| should dispatch wheel event on svg element                 | fail | **pass** | `Mouse.move/wheel`                      |                                                            |
| should scroll when nobody is listening                     | fail | **pass** | `Mouse.move/wheel`                      | Scroll emulated                                            |
| should set the modifiers                                   | fail | **pass** | `Keyboard.down`, `Mouse.wheel`          |                                                            |
| should scroll horizontally                                 | fail | **pass** | `Mouse.move/wheel`                      | Scroll emulated                                            |
| should work when the event is canceled                     | fail | **pass** | `Mouse.wheel`                           | Canceled event does not scroll (pinned WebView fails this) |

### `page-drag.spec.ts`

| Test                                                         | Main | Spike    | Evidence                                             | Cause / note                                                                    |
| ------------------------------------------------------------ | ---- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Drag and drop › should work @smoke                           | fail | **pass** | `Page.hover`, `Mouse.down`, `Page.hover`, `Mouse.up` | Emulated drag                                                                   |
| › should send the right events                               | fail | **pass** | same                                                 | Chromium's exact 8-event order                                                  |
| › should not send dragover on the first mousemove            | fail | **pass** | same                                                 |                                                                                 |
| › should work inside iframe                                  | fail | fail     | `Page.evaluateHandle`                                | Other realm; fails in the bridge at `ElementHandle.contentFrame` (out of scope) |
| › should cancel on escape                                    | fail | **pass** | + `Keyboard.press`                                   | Escape → `dragend` only, then `mouseup`                                         |
| › iframe › should drag into an iframe                        | skip | skip     |                                                      | Upstream `fixme`                                                                |
| › iframe › should drag out of an iframe                      | skip | skip     |                                                      | Upstream `fixme`                                                                |
| › should respect the drop effect                             | fail | **pass** | 14 × hover/down/hover/up                             | Needs the `DataTransfer` instance accessors                                     |
| › should work if the drag is canceled                        | fail | pass     | same                                                 | Also passes with no drag: weak                                                  |
| › should work if the drag event is captured but not canceled | fail | **pass** | same                                                 |                                                                                 |
| › should be able to drag the mouse in a frame                | fail | fail     | `Mouse.*`, native `Page.frames`                      | Other realm: iframe receives nothing                                            |
| › should work if a frame is stalled                          | fail | **pass** | same, native `Page.route`                            |                                                                                 |
| › should work with the helper method                         | fail | **pass** | `Page.dragAndDrop`                                   |                                                                                 |
| › should dragAndDrop with tweened mouse movement             | fail | **pass** | `Page.dragAndDrop`                                   | `steps: 4`                                                                      |
| › should dragTo with tweened mouse movement                  | fail | **pass** | `Locator.dragTo`                                     |                                                                                 |
| › should allow specifying the position                       | fail | **pass** | `Page.dragAndDrop`                                   | `offsetX/Y` 34;7 and 10;20                                                      |
| › should work with locators                                  | fail | **pass** | `Locator.dragTo`                                     |                                                                                 |
| should work if not doing a drag                              | fail | **pass** | `Mouse.*`                                            |                                                                                 |
| should report event.buttons                                  | fail | **pass** | `Mouse.*`                                            |                                                                                 |
| should handle custom dataTransfer                            | fail | **pass** | `Page.hover`, `Mouse.*`                              |                                                                                 |
| what happens when dragging element is destroyed              | fail | pass     | `Locator.dragTo`                                     | Expected text holds without any drop: weak                                      |

### `tap.spec.ts` (pinned `tests/library/tap.spec.ts`)

**Reachability.** On `main` this spec is unreachable. It is not in the corpus, and it imports `contextTest` from `../config/browserTest`, which the harness does not export. With the spike's one-line export (the page fixture, which honours `it.use({ hasTouch: true })`) it runs unchanged.

The other pinned tap test, `should throw on tap if hasTouch is not enabled`, lives in `tests/library/browsercontext-viewport.spec.ts`. That file imports `../../packages/playwright-core/lib/coreBundle`, which does not exist in this harness, so it cannot load. A throwaway probe through the same bridge confirmed the gate's messages: `The page does not support tap` for `page.tap` and `locator.tap`, and `hasTouch must be enabled` for `touchscreen.tap`. The probe was not committed.

| Test                                                   | Spike    | Evidence                                   | Cause / note                                |
| ------------------------------------------------------ | -------- | ------------------------------------------ | ------------------------------------------- |
| should send all of the correct events @smoke           | **pass** | `Page.tap`, `ElementHandle.evaluateHandle` | Exact 14-event Chromium sequence            |
| trial run should not tap                               | **pass** | `Page.tap`                                 | Interceptor blocks the trial tap, as pinned |
| should not send mouse events touchstart is canceled    | **pass** | `Page.tap`                                 |                                             |
| should not send mouse events when touchend is canceled | **pass** | `Page.tap`                                 |                                             |
| should not wait for a navigation caused by a tap       | fail     | none (fails at `goto`)                     | Navigation ends the document                |
| should work with modifiers                             | **pass** | `Page.tap`, `Keyboard.down/up`             |                                             |
| should send well formed touch points                   | **pass** | `Touchscreen.tap`                          |                                             |
| should wait until an element is visible to tap it      | fail     | `Page.evaluateHandle`                      | `ElementHandle.tap` is not in the adapter   |
| locators › should send all of the correct events       | pass     | `Locator.tap` ×2                           | No assertion: diagnostic                    |

The expected sequences in these specs are what the spike was written to reproduce. The passes show the synthetic sequence equals the one Chromium records. They are not independent evidence that apps behave identically.

### Failure clusters

Across `page-mouse`, `wheel` and `page-drag` (12 non-passing) plus tap (2):

| Cause                                  | Tests                                                                                                                                        | Reachable by script?          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `isTrusted`                            | 4: click document, dblclick div, down/up click, custom-button pointerdown                                                                    | No                            |
| Native `:hover`                        | 3: all "should trigger hover state" tests (one also hits a separate `Page.hover` same-realm `Node` bug)                                      | No                            |
| Native scroll                          | 0 remaining; 3 wheel tests pass only because the adapter scrolls with `scrollBy`                                                             | Approximated                  |
| Native drag start                      | 0 remaining; 10 drag passes need drag events, which only the emulation produces                                                              | Approximated                  |
| Native default action (text selection) | 1: select the text with mouse                                                                                                                | No (not attempted)            |
| Other realm (iframe)                   | 3: drag inside iframe (bridge stops at `contentFrame`), drag the mouse in a frame, hover across iframe boundaries                            | No (single-document boundary) |
| Other page (popup)                     | 1: wheel after popup (timeout)                                                                                                               | No                            |
| Navigation                             | 1: tap navigation                                                                                                                            | No (runtime boundary)         |
| Harness/bridge                         | Fixed in the spike: `ElementHandle.evaluateHandle` transport, `contextTest` export. Remaining: `ElementHandle.contentFrame` in `attachFrame` | Harness work                  |
| Other adapter gap                      | 1: `ElementHandle.tap`                                                                                                                       | Yes, separately               |

### Regression check

The full corpus `baseline:check` was run with the spike in place, without promotion; see [Spike regression check](#spike-regression-check).

## 4. Honest partial contract

One sentence per member, in the ledger's style. Runtime-wide facts stay in the README's **Synthetic input** boundary and do not downgrade by themselves. That boundary currently reads "Input events are not browser-trusted…" ([README](https://github.com/enekesabel/playwright-lite/blob/524350528c1dfe8a7867663f286efbf27923f908/README.md#runtime-boundaries)); it should also say that synthetic events grant no user activation and never apply CSS `:hover` or `:active`.

| Member                                | Draft ledger note                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mouse.move`                          | Moves the pointer that `hover()` and `click()` share and dispatches pointer and mouse move, over/out and enter/leave events to the element `elementFromPoint()` reports, so elements inside iframes receive nothing; moving with the left button held from a draggable element emulates HTML drag and drop as described for `locator.dragTo()`. |
| `mouse.down`                          | Dispatches `pointerdown`, `mousedown` and, for the right button, `contextmenu`, and focuses the target, but starts no text selection, context menu or autoscroll.                                                                                                                                                                               |
| `mouse.up`                            | Dispatches `pointerup`, `mouseup` and a `click`, `auxclick` or `dblclick` on the nearest common ancestor of the press and release targets; during an emulated drag it drops instead.                                                                                                                                                            |
| `mouse.click`                         | Runs `mouse.move()`, `down()` and `up()` with their differences.                                                                                                                                                                                                                                                                                |
| `mouse.dblclick`                      | Runs `mouse.move()`, `down()` and `up()` twice with their differences.                                                                                                                                                                                                                                                                          |
| `mouse.wheel`                         | Dispatches a `wheel` event and, unless it is canceled, scrolls the nearest scrollable ancestor or the window by the deltas at once, without smooth scrolling or scroll chaining.                                                                                                                                                                |
| `touchscreen.tap`                     | Requires `navigator.maxTouchPoints > 0` in place of the `hasTouch` context option, and dispatches Chromium's touch, pointer and compatibility mouse events without its gesture handling such as double-tap zoom.                                                                                                                                |
| `Page.tap` / `Locator.tap`            | Same as `touchscreen.tap()` after Playwright's actionability checks.                                                                                                                                                                                                                                                                            |
| `Locator.dragTo` / `Page.dragAndDrop` | Emulates HTML drag and drop in the current document with a script-created `DataTransfer` whose data is also readable during `dragenter` and `dragover`; drags that start from selected text or cross into another frame or window are unsupported, and the browser's default drop actions, such as inserting dropped text, do not run.          |

Details the notes leave out, which the decision may want in the README:

- **Unset `dropEffect`.** The emulation initialises an unset `dropEffect` from the HTML table, so `copyMove` gives `copy`. Chromium chose `move` for a native drop in the same setup (measured with native `page.dragAndDrop`).
- **Drag start.** A drag starts on the first move, with no distance threshold.
- **Trial runs.** Trial `tap` performs the input with its events blocked, like Playwright.

Verdict on honesty:

- **No member is "not honest".** Each difference names a concrete, checkable behaviour.
- **Drag is the most exposed.** In one case it does more than the browser: `getData()` works during `dragover` (native Chromium returned `""` there). It also depends on an own-property shim on the `DataTransfer` the adapter creates. Without the shim the note would instead have to say that `effectAllowed` and `dropEffect` always read `"none"` and effects are ignored. That is still honest but much weaker.

## Recommendation for the decision

For [Do synthetic mouse, touch, tap and drag ship, and under which contract?](https://github.com/enekesabel/playwright-lite/issues/155):

1. **Ship all eleven members as `partial` with the notes above, as one change.** They share one pointer state machine with the existing `click`/`hover`. The spike shows the cost is small: no dependency, no `createPage` option, no host-global patch. Splitting them would duplicate that state; `mouse.down` over a draggable element already implies drag.
2. **Include drag emulation.** Use the instance-level `effectAllowed`/`dropEffect` accessors. Without emulation `dragTo`/`dragAndDrop` would do nothing for HTML drag-and-drop pages, and the pinned `Locator.drop` already establishes script-dispatched drag events as Playwright behaviour. Decide explicitly whether to mirror native protected mode, which would hide `getData()` outside `dragstart`/`drop` with one more accessor, or to document the difference as drafted.
3. **Decide the `hasTouch` analogue.** The options are `navigator.maxTouchPoints > 0` or no gate. The gate keeps Playwright's error on desktop documents and matches the pinned `tap` tests.
4. **Fix the related ledger drift in the same decision.** `Page.hover`/`Locator.hover` are ledgered `implemented` (full) but never apply `:hover`. Their notes, `mouse.move` and the runtime boundary should state that once.
5. **Harness work belongs with the implementation, not the decision.** It needs the `ElementHandle.evaluateHandle` handle route, the `contextTest` export, and `tap.spec.ts` in the corpus. About 25 pointer tests and 6 tap tests would then be promotion candidates, subject to the sabotage rerun. The weak and diagnostic passes listed above should stay out.
6. **Priority is unchanged.** The earlier demand research still ranks this family below `expect`, navigation observation and events. The spike lowers the cost; it does not raise the demand.

## Spike regression check

With the spike in place, `node scripts/upstream-baseline.mjs check` ran the whole corpus: 103 specs, 2081 tests, 22 minutes. It then stopped at its own guard, `Selected test count mismatch. Baseline: 2072, Report: 2081`, because the spike adds the 9 tap tests. The guard is working as intended; nothing was promoted.

The same run's `test-results/compatibility.json` was compared against `tests/upstream/baseline.json`. All 739 reviewed entries are present and passing, so the spike changes to `movePointerTo`, the keyboard `Escape` path and the bridge regress no reviewed test.
