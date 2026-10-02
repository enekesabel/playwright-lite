# Screenshot cancellation, cleanup and silent media failures

Investigation for [#255](https://github.com/enekesabel/playwright-lite/issues/255) under spec [#251](https://github.com/enekesabel/playwright-lite/issues/251). This directory is a design probe: nothing in `src/` imports it, it adds no public option, and it promotes no compatibility evidence.

## Run

```sh
pnpm install --frozen-lockfile
node prototype/screenshot-cancellation/probe.mjs            # every scenario, writes observations.json
node prototype/screenshot-cancellation/probe.mjs twoPages   # some scenarios, writes observations.partial.json
```

`CHROMIUM_EXECUTABLE=/path/to/chrome` selects a browser other than Playwright's own install. [`probe.mjs`](probe.mjs) serves this directory from two loopback origins (the second sends no CORS headers), records a short VP8 clip in the browser, and runs each scenario of [`harness.js`](harness.js) in a fresh context. Resource routes can be stalled, failed or served on demand.

[`observations.json`](observations.json) was recorded with Node 22.22.0, Playwright 1.62.1 and Chromium 141.0.7390.37. Devbox was unavailable in the recording environment, so Node 22 ran instead of the pinned Node 24, and the preinstalled Chromium ran instead of Playwright 1.62.1's Chromium 151. SnapDOM is the published 3.2.0 `dist/snapdom.mjs` (sha256 `b95213d4…30b2`, MIT, [`vendor/`](vendor)); source references point at the [v3.2.0 tag](https://github.com/zumerlab/snapdom/tree/v3.2.0). The font fixture is the pinned Playwright `tests/assets/webfont/iconfont.woff2`.

## Recommendation

One capture operation, shared by Page, Locator and ElementHandle screenshots, runs under a per-document coordinator. [`coordinator.js`](coordinator.js) is the reference; `screenshot()` in [`harness.js`](harness.js) is the operation.

1. **Coordinator.** One per window, created like [`perWindow`](../../src/hostGlobals.ts#L15) and shared by every Page instance of the package copy. It owns a FIFO lease, the renderers it started, and cleanup of SnapDOM scaffolding.
2. **Sequence.** Acquire the lease (an aborted waiter leaves the queue). Apply the pinned preparation, returning its cleanup as a closure. Await `document.fonts.ready` under the operation signal. Pre-scan media. Run SnapDOM with `{ plugins: [capturePlugin], burst: false, invalidate: true, cache: "disabled" }`, leaving `placeholders`, `embedFonts` and `fast` at their defaults. Scan the clone at `afterClone` and the serialized SVG at `afterRender`. Restore the preparation at `afterRender`, then export. Release the lease when the renderer settles.
3. **Cancellation.** The operation signal combines the deadline, the caller's `signal` and the Page lifetime, as [`PageLifetime.bind`](../../src/lifetime.ts#L85) does. The caller rejects as soon as it aborts, through the same race as [`PageLifetime.race`](../../src/lifetime.ts#L119), with the losing renderer observed. At that moment the preparation is restored and the capture's token is marked canceled. The plugin throws at the renderer's next stage boundary, so a canceled renderer never composes, exports or returns bytes. The lease stays held only until that renderer leaves SnapDOM's clone stage: the outer capture's `afterClone`, or the renderer settling. A same-origin iframe is rasterized by a nested capture that runs the same plugins inside the outer clone stage ([clone.helpers.js#L528](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/utils/clone.helpers.js#L528)), so the plugin compares `context.element` with the target before ending the stage.
4. **Cleanup.** Each lease release removes an empty `#snapdom-sandbox`. SnapDOM's export decode frame is removed when no renderer of the document is in flight.
5. **Media policy.** Reject on any finding of the scans below and on SnapDOM's `image-fallback` warning. Name the element or URL in the error.

No global timer, fetch or console patching is involved, and no new dependency or public option.

## 1. A stalled capture and its interruption

The caller's rejection and the renderer's work are separate. Rejection takes one task. SnapDOM accepts no `AbortSignal`: its fetches use a private controller with a 3000 ms timeout ([snapFetch.js#L230](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/snapFetch.js#L230), [#L344](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/snapFetch.js#L344)). Its hooks are awaited without a catch ([plugins.js#L101](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/core/plugins.js#L101)), so a throwing hook is the only way to stop it, and only at stage boundaries. Errors from the per-node `resolveNode` hook are swallowed ([clone.js#L401](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/core/clone.js#L401)), so the clone walk itself cannot be stopped.

| Stall                                                                                                                                                                                                                 | Interrupt (timeout, signal, close)       | Renderer afterwards                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.fonts.ready` on a stalled webfont (pinned [`should wait for fonts to load`](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/page/page-screenshot.spec.ts#L941)) | rejects at 300 ms; host restored exactly | never started. Once the font is served, a capture from another Page completes, but without the font: SnapDOM skipped `pwtest-iconfont` (section 4)                                                                                                                                                                                                                   |
| `<img>` whose response never arrives                                                                                                                                                                                  | rejects at 300 ms; host restored exactly | With the plugin, it stops at `beforeRender` after about 3 s and nothing changes in the document after the rejection. Without it, it returns placeholder bytes after about 3 s and adds and removes a decode `<iframe>` in `<body>`                                                                                                                                   |
| `background: url(…) fixed` whose response never arrives                                                                                                                                                               | rejects at 1000 ms                       | still pending 7 s later: `freezeFixedBackground` awaits `img.decode()` with no timeout ([background.js#L251](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/background.js#L251)). A later capture from another Page gets the lease within 1 ms and succeeds in under 40 ms. When the response finally arrives, the old renderer stops at `beforeRender` |

## 2. Two Page instances in one document

Pinned preparation keeps a single cleanup per window ([`window.__pwCleanupScreenshot`](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/screenshotter.ts#L158)), and pinned serialization is a per-Page `TaskQueue` ([#L166](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/screenshotter.ts#L166)). Neither is enough when Page instances share a document. With two overlapping preparations, the second overwrites the slot and the first style element is never removed (`pinnedCleanupSlot`).

In `twoPages`, Page A captures an element whose image never loads. Its `style` gives `#b` a red background through a rule that outranks Page B's green rule. Page B starts 100 ms later and captures `#b`.

| Run                        | A                 | B                                                  | After A's renderer settles                                                                                                            |
| -------------------------- | ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| timeout, signal, `close()` | rejects at 501 ms | gets the lease at 501–502 ms; pixel green          | A stopped at `beforeRender` about 3 s later and returned no value. The host is identical to the start and no rejection went unhandled |
| uncoordinated              | rejects at 501 ms | captured while A's preparation was live; pixel red | SnapDOM's decode `<iframe>` remains in `<body>`                                                                                       |

The only document change after B resolved was the coordinator removing B's decode frame once A's renderer settled. While A's renderer is pending, that frame stays.

**The lease must outlive a canceled caller while SnapDOM is cloning.** During the clone stage SnapDOM rewrites live text of `-webkit-line-clamp` elements and undoes it after cloning ([capture.js#L146–L175](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/core/capture.js#L146-L175)). It can also add temporary border and `content-visibility` styles, and pins a same-origin iframe's viewport. The clone stage can wait on the network: pseudo-element `url()` content is fetched inside it. In `lineClamp`, the page read `"The quick brown fox jumps over the lazy …"` mid-capture. A canceled at 302 ms during that stage, restored its preparation at once, and kept the lease until its `afterClone` at 3007 ms. B then ran, and the text was intact afterwards. SnapDOM's undo is guarded ([lineClamp.js#L168](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/lineClamp.js#L168)): a page edit made mid-capture survived. Overlapping raw captures of that fixture also restored the text, because the second saw text that already fit.

## 3. The safe boundary for live preparation

SnapDOM reads live state after `afterClone`. Its asset phase reads live computed backgrounds ([capture.js#L225](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/core/capture.js#L225)) and font usage ([#L273](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/core/capture.js#L273)). Its compose step reads the live root's geometry right after `beforeRender` ([svg.js#L214](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/engines/svg.js#L214)). Compose has no await between `beforeRender` and `afterRender`, and export reads only the serialized SVG. `safeBoundary` applies `#box { background: green; width: 160px }` over a 100 px box with a blue image background:

| Preparation removed                      | Output                                                     |
| ---------------------------------------- | ---------------------------------------------------------- |
| at `afterRender` (recommended)           | 160 × 50, green                                            |
| at `beforeRender`                        | 100 × 50, green: compose measured the restored width       |
| at `afterClone`                          | 100 × 50, blue: the asset phase inlined the restored image |
| never live, `<style>` put into the clone | 100 × 50, green: the cloned layout ignores it              |

So temporary CSS stays live from before `beforeClone` until `afterRender`. Renderer-owned detached preparation does not reproduce it. Masks need no live state: draw them on the output canvas at rectangles measured before capture (#256).

Pinned caret restoration is exact in CSSOM terms but not in the document. It re-serializes each touched `style` attribute and leaves `style=""` on elements that had none (`caretRestoration`). The reference also restores the attribute text when the inline style is otherwise unchanged, which makes the result identical.

## 4. Media failures

| Failure (fixture in `media`)                                           | SnapDOM 3.2.0 output                                                                                         | Warning                                           | Detected                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| tainted canvas                                                         | transparent ([clone.js#L967](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/core/clone.js#L967))        | none                                              | before (scratch-canvas readback) and at `afterClone` (clone `<img>` has no image data) |
| failed background URL                                                  | no background                                                                                                | none                                              | at `afterRender`: the SVG keeps the external `url()`                                   |
| failed inline-SVG `<image>`                                            | blank ([images.js#L185](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/images.js#L185))         | none                                              | at `afterRender`: the SVG keeps the external `href`                                    |
| failed `<img>`                                                         | grey placeholder                                                                                             | `image-fallback`; none with `placeholders: false` | at `afterRender`: the cloned `<img>` left the tree, whatever the placeholder option    |
| cross-origin video without CORS                                        | transparent, or the poster when one is set                                                                   | none                                              | before (scratch readback `SecurityError`) and at `afterClone`                          |
| video with no decoded frame                                            | transparent                                                                                                  | none                                              | before (`readyState`) and at `afterClone`                                              |
| cross-origin iframe                                                    | striped placeholder                                                                                          | console only                                      | before (`contentDocument` is `null`)                                                   |
| loaded webfont whose family name contains "icon", "glyph" or "symbols" | fallback glyphs ([fonts.js#L706](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/fonts.js#L706)) | none                                              | at `afterRender`: a family used by captured text has no `@font-face` in the SVG        |

The scratch readback draws the source into a 1 × 1 canvas. It kept the source canvas's context object, pixels, `fillStyle` and `globalAlpha`, and an untouched canvas still accepted a WebGL context afterwards. Readback alone cannot replace the `afterRender` scans: backgrounds, SVG images and fonts fail inside SnapDOM's fetches and leave no warning.

Controls: a readable canvas, same-origin video, same-origin iframe, loaded inline-SVG `<image>` and plainly named webfont capture with no finding. An `<img>` of an SVG file that references external images renders blank in the live page too, so it is not a capture difference.

A same-origin iframe's nested capture runs the same plugin, so its clone and SVG are scanned too: a failed background inside such a frame was reported at the nested `afterRender`. The pre-scan also descends into same-origin frames. Not covered: `<object>`/`<embed>` content, and any failed resource that SnapDOM drops instead of leaving its URL in the SVG.

## Cross-capture state

| State                                                                                                                                                                                                                                                                         | Observed                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| snapFetch error cache: 8 s, keyed by URL, shared by captures, untouched by `cache` ([snapFetch.js#L84](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/snapFetch.js#L84), [#L232](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/snapFetch.js#L232)) | A capture canceled at 300 ms on a stalled image recorded a timeout at 3 s. The image was then served (HTTP 200), and the next capture rejected `image-substituted`, with or without `cache: "disabled"`. After 8 s it succeeded                                                                                                                                           |
| failed backgrounds cached as `null` until `cache: "disabled"` resets them ([image.js#L60](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/utils/image.js#L60))                                                                                                            | After a 404 and 8 s more, the served background still rejected, also with `invalidate: true`. With `cache: "disabled"` it rendered                                                                                                                                                                                                                                        |
| style snapshots that only DOM mutations invalidate ([styles.js#L397](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/styles.js#L397))                                                                                                                             | After `insertRule`, captures with default options, `burst: false` or `cache: "disabled"` kept the old color. `invalidate: true` showed the new one, and `invalidate: true` with `cache: "disabled"` showed the next change too                                                                                                                                            |
| SnapDOM scaffolding in `<body>`                                                                                                                                                                                                                                               | A raw capture leaves its decode `<iframe>` after export ([toCanvas.js#L447](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/exporters/toCanvas.js#L447)). The sandbox is removed only at the end of compose, outside any `finally` ([svg.js#L626](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/engines/svg.js#L626)). Through the coordinator, neither remains |

These failures are detected, so they turn into rejections rather than wrong images. The error cache still lets canceled work make a later capture fail.

## Acceptance cases for #256 (and #252)

Each runs through the public API and decodes the returned bytes in the browser.

1. A capture stalled on a resource rejects by `timeout`, by `signal` and by `page.close()` within one task of the trigger, with the pinned messages. Afterwards the host DOM, caret styles and `style` attribute text equal the pre-capture snapshot, and no rejection is unhandled.
2. Page A's capture, stalled with `style` and `mask`, is canceled while Page B's capture of the same document is queued. B's pixels show only B's style and masks. A's promise never resolves, and the document after A's renderer settles equals the snapshot.
3. While a canceled renderer remains pending (stalled fixed background), another capture in the document succeeds without waiting for it.
4. A capture canceled inside SnapDOM's clone stage (stalled pseudo-element content) delays the next capture until that stage ends, and line-clamped text is intact afterwards.
5. The stalled-webfont case rejects with `Timeout <n>ms exceeded.` (the pinned test also expects its `waiting for fonts to load...` log line). Once the font is served, the next capture completes for a plainly named family. With the pinned `pwtest-iconfont` family it rejects with the webfont finding until SnapDOM's heuristic can be turned off.
6. Temporary style that changes both background image and width produces the `restoreAfterRender` output above, and the document is restored after success, error, timeout, abort and close.
7. Each failure row in section 4 rejects with an error naming the element or URL, with `placeholders` at its default. Its readable control succeeds, and the pre-scan leaves the canvas's context, pixels and mode as they were.
8. A CSSOM-only style change between two captures appears in the second.

## Upstream asks and residual limits

- **Capture signal.** SnapDOM cannot be told to stop. In-flight fetches run to their 3 s timeout, and a fixed background's `img.decode()` can stay pending indefinitely, holding memory but no lease. Ask for an `AbortSignal` option.
- **Fetch options.** Ask for per-capture `timeout` and `errorTTL` (or no shared error cache). Until then, a resource that failed in any capture during the previous 8 s makes the next capture reject.
- **Scaffolding.** Ask for `finally` around the sandbox removal and for the decode frame not to outlive its export. Until then the coordinator removes both.
- **Icon-font heuristic.** Ask for an opt-out. Until then, captures of text in such families reject. The pinned webfont test's own font, `pwtest-iconfont`, is one.
- **Line clamp.** Clamped text in the live document is rewritten for the length of the clone stage, and other Page instances can read it. This is bounded by the clone stage's own waits, about 3 s per fetch. A nested same-origin iframe capture, which runs inside the outer clone stage, was not probed and could hold it longer.
- **Not probed.** The asset phase can add and remove `<link rel="stylesheet">` elements for font `@import`s ([fonts.js#L961](https://github.com/zumerlab/snapdom/blob/v3.2.0/src/modules/fonts.js#L961)). A canceled renderer that already passed `afterClone` can still do that while the next capture runs. Removal is bounded at 3 s.
- **Package copies.** Independently compiled copies of the package each get their own coordinator, so they do not coordinate with each other.

## Product choices to confirm

1. Cross-origin iframes reject. Playwright captures them; a DOM renderer cannot read them.
2. Unreadable video rejects, including a poster substituted for the current frame.
3. A webfont used by captured text that SnapDOM did not embed rejects, including icon-named families.
4. Until SnapDOM's error cache is configurable, a capture can reject for a resource that failed during the previous 8 s.
5. The renderer runs with `invalidate: true` and `cache: "disabled"` on every capture, which trades SnapDOM's style and resource caching for correctness.
6. While a capture runs, the document can contain the temporary preparation (as in Playwright), SnapDOM's hidden sandbox and decode frame, and rewritten line-clamped text. All are gone when the operation and its renderer have settled.
