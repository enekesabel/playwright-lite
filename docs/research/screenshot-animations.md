# Finished-animation rendering in screenshot capture

Investigation for [#257](https://github.com/enekesabel/playwright-lite/issues/257), under [spec #251](https://github.com/enekesabel/playwright-lite/issues/251). This is diagnostic research. It adds no production screenshot support, advertises no `animations: "disabled"` claim and promotes no baseline entry. Native Playwright captures below are feasibility references only.

## Verdict

The mismatch is not an animation bug and not a raster or encoding bug. SnapDOM 3.2.0 reads the finished value correctly, then the clone it renders carries author CSS that outranks that value.

- **Stylesheet mechanism (the retained fixture).** With `document.documentElement` as the capture root, the clone keeps `<head style="display:none !important"><style>…</style></head>`. The author rule `#target { background: #e84848 }` sits inside the SVG's `foreignObject`, and it beats SnapDOM's generated `.c1 { background-color: rgb(0, 255, 0) }` by specificity (`#id`) or by source order (`.class`, because the cloned `<style>` comes after the generated one).
- **Inline mechanism (a second cause, not in the retained fixture).** An authored `style="background:#e84848"` is copied onto the clone and outranks the generated class. SnapDOM already re-resolves inline declarations to computed values for `!important` and context-dependent values (`normalizeInlineStyleToComputed`), but not for animated properties.
- **Scope.** Any value that lives only in the animation or transition layer is affected: finished fill-forwards animations, and, with `animations: "allow"`, any animation or transition still in flight. The default capture mode is therefore wrong for in-flight transitions today, not only the disabled mode.
- **Correction.** A per-capture `afterClone` plugin using only documented plugin context (`ctx.clone`, `ctx.nodeMap`) removes the cloned `<style>`/stylesheet `<link>` elements and re-resolves inline declarations of animated properties, and their longhands, to the source's computed value. It matched native Playwright on every animation scenario probed and changed no static regression scenario. No new public option, global registration or renderer fork is needed.
- **Preparation is reused unchanged.** The pinned `inPagePrepareForScreenshots` runs as injected. Its finish, cancel and event ordering are the same with a capture in the middle as without. The correction does not freeze or cancel anything.

All measurements are Chromium 141.0.7390.37 (Playwright 1.62.1, SnapDOM 3.2.0). Firefox and WebKit were not available and are unverified. The prototype recorded the same red result on Chromium 151.

## Reproduce

```sh
pnpm install --frozen-lockfile
node scripts/screenshot-animations-probe.mjs --json docs/research/screenshot-animations.observations.json
```

The probe installs `@zumer/snapdom@3.2.0` into the OS temp directory unless `SNAPDOM_DIST` names its `dist/snapdom.js`. `PROBE_CHROMIUM` selects a Chromium executable when Playwright's own is not installed. `--only <id>` runs one scenario (`stages`, `events` and `lifecycle` are also ids). The pinned preparation function is read from `playwright-core`'s compiled bundle and injected as Playwright does, `'(' + fn.toString() + ')(...)'`.

Each scenario is rendered four ways and compared with a native `page.screenshot({ animations: "disabled", clip })` of the same fixture. The two scenarios marked `animations: "allow"` run no preparation and compare with a native `page.screenshot({ animations: "allow", clip })`, which records the in-flight transition value. "Different %" counts pixels whose RGB channel differs by more than 24 from native.

| Variant   | What changes                                                                             |
| --------- | ---------------------------------------------------------------------------------------- |
| `default` | SnapDOM as the prototype called it (`documentElement` root, `clip`, `cache: "disabled"`) |
| `head`    | documented option `exclude: ["head"], excludeMode: "remove"`                             |
| `strip`   | `afterClone` plugin removing every `<style>` and `<link rel~=stylesheet>` from the clone |
| `full`    | `strip`, plus re-resolving inline declarations of animated properties to computed values |

## Where finished style is lost

Stage inspection on the minimal fixture (`#t { background: #e84848 }`, WAAPI `#e84848 → #00ff00`, 60 s, `fill: forwards`, finished by the pinned preparation):

| Stage                                         | Value                                                     |
| --------------------------------------------- | --------------------------------------------------------- |
| Live `getComputedStyle(#t).backgroundColor`   | `rgb(0, 255, 0)`                                          |
| SnapDOM style snapshot (generated class)      | `.c1{… background-color:rgb(0, 255, 0) …}` (correct)      |
| Clone serialized into the SVG                 | also holds `<head><style>#t{…background:#e84848}</style>` |
| SVG rasterized as generated                   | pixel `[232, 72, 72]` (red)                               |
| Same SVG with only the head `<style>` removed | pixel `[0, 255, 0]` (green)                               |

The first point at which the finished value is overridden is the cascade inside the rendered SVG. The computed-style snapshot and the PNG/canvas export are both correct and play no part. Retained fixture, same root cause: default 80.2% different from native, every correction 0%.

Controlled variations of the base declaration, same finished animation:

| Base value comes from | default | `head` | `strip` | `full` |
| --------------------- | ------- | ------ | ------- | ------ |
| `#id` rule            | red     | green  | green   | green  |
| `.class` rule         | red     | green  | green   | green  |
| tag rule              | green   | green  | green   | green  |
| inline `style`        | red     | red    | red     | green  |
| `!important` rule     | red     | red    | red     | red    |

The tag rule is lower specificity than `.c1` and loses, which is why the original report looked animation-specific. The `!important` case is correct everywhere: the author rule beats the animation live too, and native is red.

## Probed scenarios

Rows are the colour sampled in the target and the difference from native. `native` is the reference colour. Full numbers, including the second sample point and warnings, are in `screenshot-animations.observations.json`.

| Scenario                                                                   | native     | default    | `full`    |
| -------------------------------------------------------------------------- | ---------- | ---------- | --------- |
| Retained fixture (WAAPI finite fill, infinite cover)                       | green      | red, 80.2% | green, 0% |
| WAAPI finite fill, `#id` or `.class` base                                  | green      | red, 51%   | green, 0% |
| WAAPI finite fill, inline base                                             | green      | red, 51%   | green, 0% |
| WAAPI animates `background`, inline sets only `background-color`           | green      | red, 51%   | green, 0% |
| WAAPI finite fill, base from a `<style>` in the body                       | green      | red, 51%   | green, 0% |
| WAAPI finite fill, inline background, opacity, transform, width            | half-green | red, 51%   | 0%        |
| WAAPI finite fill, inline border-color, box-shadow, margin, radius, height | white      | red, 28%   | 0%        |
| WAAPI finite, no fill                                                      | red        | red, 0%    | red, 0%   |
| WAAPI infinite (cancelled)                                                 | red        | red, 0%    | red, 0%   |
| CSS `@keyframes` finite, fill forwards                                     | green      | red, 51%   | green, 0% |
| CSS `@keyframes` finite, no fill                                           | red        | red, 0%    | red, 0%   |
| CSS infinite rotation                                                      | red        | red, 0%    | red, 0%   |
| CSS transition finished by preparation                                     | green      | green, 0%  | green, 0% |
| CSS finite fill-forwards on `::after`                                      | green      | green, 0%  | green, 0% |
| WAAPI finite fill inside an open shadow root                               | green      | green, 0%  | green, 0% |
| **`animations: "allow"`**, CSS transition in flight (stylesheet)           | red        | green, 51% | red, 0%   |
| **`animations: "allow"`**, transition from an inline write in flight       | red        | green, 51% | red, 0%   |

Static regression scenarios, run through the same four variants: pseudo-elements, `:nth-child`/attribute/`:has()`/`:is()`/`:not()`, `:checked + label`, `@media`, `@container`/`@supports`, `:root` custom properties, a `<style>` in the body after its target, the a `<style>` inside an inline `<svg>` painting its shapes, the pinned `style` option on the document and on an open shadow root, and pinned caret hiding. `full` differed from `default` by 0% in every one. The two remaining differences from native are the accepted caret rendering (0.94%) and a 0.01% difference on `:checked`; both are identical across variants.

## Preparation semantics with a capture in the middle

Compared against the expectations of the pinned tests (`tests/page/page-screenshot.spec.ts:865`, `:889`, `:913`, `:754`, `:743`) with and without a SnapDOM capture between preparation and cleanup:

| Animation                    | Events                        | After cleanup               | With capture |
| ---------------------------- | ----------------------------- | --------------------------- | ------------ |
| CSS transition               | `onfinish`, `transitionend`   | removed                     | identical    |
| CSS animation, finite        | `onfinish`, `animationend`    | removed                     | identical    |
| CSS animation, infinite      | `oncancel`, `animationcancel` | `running` again (restarted) | identical    |
| WAAPI, finite, fill forwards | `onfinish`                    | stays `finished`            | identical    |
| WAAPI, infinite              | `oncancel`                    | `running` again             | identical    |

Finite animations are finished, not cancelled, and stay finished. Infinite ones are cancelled for the capture and `play()`ed at cleanup, which restarts a CSS animation from its beginning, exactly as native Playwright does. SnapDOM adds nothing to this.

## Correction

```js
const stripAuthorStylesAndAnimatedInline = {
  name: "pwlite-capture-snapshot",
  afterClone(ctx) {
    // Computed-style snapshots own the look; cloned author CSS only overrides them.
    ctx.clone
      .querySelectorAll("style, link[rel~=stylesheet]")
      .forEach((node) => node.remove());
    // Inline declarations lose to animations live but win in the clone.
    const animated = new Map();
    for (const root of rootsOf(document)) {
      for (const animation of root.getAnimations()) {
        const target = animation.effect?.target;
        if (!target || animation.effect.pseudoElement) continue;
        const props = animated.get(target) ?? new Set();
        for (const frame of animation.effect.getKeyframes())
          for (const key of Object.keys(frame))
            if (!KEYFRAME_META.has(key)) props.add(toKebab(key));
        animated.set(target, props);
      }
    }
    for (const [cloned, source] of ctx.nodeMap) {
      const props = animated.get(source);
      if (!props || !cloned.style?.length) continue;
      const computed = getComputedStyle(source);
      for (const prop of props)
        for (const longhand of longhandsOf(prop))
          if (cloned.style.getPropertyValue(longhand) !== "")
            cloned.style.setProperty(
              longhand,
              computed.getPropertyValue(longhand),
              cloned.style.getPropertyPriority(longhand)
            );
    }
  },
};
```

`rootsOf` walks open shadow roots as the pinned preparation does, `KEYFRAME_META` is `offset`, `easing`, `composite`, `computedOffset`, and `longhandsOf(prop)` is `prop` plus the longhands the browser expands it to, found by setting it on a scratch element. Expanding matters when the keyframes animate `background` and the inline style sets only `background-color`, or the reverse. The probe's `full` variant is this code.

Why this and not the alternatives:

- **Stripping the head is not enough.** `exclude: ["head"]` fixes the stylesheet mechanism only. The inline case stays red, and so does a base rule from a `<style>` placed in the body after its target (measured: `head` red, `strip` green).
- **Why dropping clone styles is safe.** An element-root capture never has them (the clone has no `<head>`), and its output is already correct. The computed snapshot already carries `@media`, `@container`, `:root` variables, pseudo-elements and structural selectors, as the regression table shows. Fonts are read from the live document (`src/modules/fonts.js:929`, `:1070`), not from the clone.
- **Freezing animations differently is rejected.** `commitStyles()` then `cancel()` would write inline styles into the live page and cancel animations that native Playwright finishes, which the pinned event tests observe. The issue also asks to reuse the pinned semantics rather than freeze everything. The pinned preparation already produces the right live state; only the render step was wrong. This alternative was reasoned about, not probed.
- **An upstream change is also possible.** The smallest renderer-side fix is to include animated properties in `normalizeInlineStyleToComputed`'s re-resolve set and not to retain document `<style>` clones when the capture root is the document. That is a SnapDOM change, so it is a recommendation, not something this repository can ship. No SnapDOM release after 3.2.0 exists yet (`3.2.1-dev.*` only); re-run the probe when pinning the production version.

### Source citations

SnapDOM 3.2.0:

- `src/core/clone.js:375-390`: a `display:none` node becomes a shell that keeps its `<style>` children (the `<head>` case).
- `src/core/prepare.js:261-273`: kept light-DOM `<style>` clones travel into the SVG (their `@media` is frozen to the live viewport, the cascade is not).
- `src/modules/styles.js:1505-1522` and `:1568`: inline declarations are re-resolved only for stylesheet `!important` and context-dependent values (`canSkip` at `:1508`).
- `src/modules/styles.js:1571-1582`: `animation: none !important` is pinned on animated clone elements.
- `src/modules/styleScan.js:213-225` and `:363`: WAAPI keyframe properties are unioned into the property universe, which is why the generated class carries the animated value.
- `src/core/capture.js:188-192`: `afterClone` runs after `prepareClone` with `clone`, `classCSS` and `nodeMap` on the context; `PLUGIN_SPEC.md:140-146` documents them.

Pinned Playwright `26a9e470a7b3c7822084b09fb7f13902c5f37b51`:

- `packages/playwright-core/src/server/screenshotter.ts:49-163`: `inPagePrepareForScreenshots` (`finish()` at `:118`, `cancel()` at `:126`, `play()` at `:149`, listeners at `:139-143`, cleanup slot at `:158`).
- `screenshotter.ts:203`, `:226`, `:251-266`: per-page queue, preparation before and restoration after (`finally`), fonts wait.
- `tests/page/page-screenshot.spec.ts:677-1000`: the animation tests the probe fixtures follow.

## Constraints for the production implementation

- **Error and abort restoration.** The correction is capture-side and owns no host state, so it adds nothing to restore. Restoration is the pinned cleanup alone. Probed: a rejecting capture followed by `finally { cleanup() }` leaves the infinite animation `running` and no temporary `<style>`. After a caller abort, SnapDOM keeps working and resolves after cleanup ran (`rendererResolvedAfterCleanup: true`), so cleanup must not be treated as the end of renderer work (see [#255](https://github.com/enekesabel/playwright-lite/issues/255)).
- **One cleanup slot per document.** The pinned function stores its cleanup in `window.__pwCleanupScreenshot`, which Playwright owns per page. Two preparations in one document before either cleanup, as two `Page` instances would produce, overwrite it. Probed outcome: the first preparation's cleanup is lost, the infinite animation never restarts and a temporary `<style>` stays. The first preparation's `animationstart` and `transitionrun` listeners are never removed, by construction, because their removal sits in the lost cleanup. Reading the slot into a closure right after each preparation and running the closures in reverse order restored everything. Coordination must be per document, not per instance (spec #251, and [#256](https://github.com/enekesabel/playwright-lite/issues/256) for temporary styles).
- **Host state the renderer leaves behind.** After an ordinary capture SnapDOM leaves one hidden `iframe[data-snapdom-internal]` in `<body>`; the markup is otherwise unchanged. It is a document-boundary fact for the cancellation and cleanup work, not for animations.
- **Document boundary.** The correction reads `getAnimations()` and open shadow roots of the current document only, like the pinned preparation. Closed shadow roots and other frames are out of reach and stay out of scope. The correction only reads and edits the clone.
- **Memoization.** SnapDOM disables its reuse paths for plugins with `afterClone` unless the plugin declares `pure: true`. The probe captures with `cache: "disabled"` and `invalidate: true`, as the prototype did. Do not declare the plugin pure, because it reads live animation state.

## Recommended next decision and implementation acceptance criteria

No new public option, `createPage` setting or changed contract is required, so there is no product or API decision to report. Two non-blocking choices, recommended defaults in brackets: apply the clone correction to every capture, not only `animations: "disabled"` (yes, the default mode is affected too); verify in Firefox and WebKit before any compatibility claim (yes).

Agent-ready criteria, for the slice that implements `animations: "disabled"` (the first capture slice should already include the plugin, because default captures of in-flight transitions are affected):

1. The shared capture implementation applies a per-capture `afterClone` plugin equivalent to the one above on every capture: it drops cloned author stylesheets and re-resolves, to computed values, the inline declarations (and their longhands) of every property a current animation or transition targets on that element. It uses only `ctx.clone` and `ctx.nodeMap`, registers nothing globally and adds no public option. Keep its stylesheet strip even if a future SnapDOM release fixes the inline case, until the probe shows otherwise.
2. `animations: "disabled"` runs the pinned `inPagePrepareForScreenshots` source unchanged, with `disableAnimations: true`, and keeps the cleanup in a closure owned by the capture operation, never in a slot another operation can overwrite. A document-wide coordinator serializes preparation across `Page` instances in one document.
3. Cleanup runs in a `finally` on success, renderer error, timeout and abort, and does not run while the renderer is still reading the document for a result that will be returned.
4. `animations: "allow"` is the default and runs no animation preparation, but still gets the plugin.
5. Contract tests under `tests/contract/screenshot.test.ts`, decoding returned bytes in the browser, cover: finite fill-forwards WAAPI and CSS animations with an `#id`, a `.class` and an inline base; an in-flight transition under `allow` and under `disabled`; an infinite animation that is cancelled for the capture and `running` afterwards; `playState` of a finite animation staying `finished`; the pinned event orders above; a shadow-root animation; and a second independent capture after an error, a timeout and an abort. Include two `Page` instances capturing in one document at once.
6. Document, concretely in the ledger and README, what is not verified: Chromium is the only engine measured here. Animations targeting a pseudo-element are skipped by the inline re-resolve (a pseudo-element has no inline style); the `::after` fill-forwards scenario rendered correctly without it.
7. Pin and verify the SnapDOM version and re-run `scripts/screenshot-animations-probe.mjs` against it; the plugin's two behaviours must still be needed (or be replaced by an upstream fix) before the plugin is kept.
8. Do not mark `animations` supported, promote baseline entries or edit `README.md` until the ledger and generated README can state exactly what the contract tests prove.
