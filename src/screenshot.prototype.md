# Screenshot capture feasibility

Throwaway prototype for [decision issue #44](https://github.com/enekesabel/playwright-lite/issues/44). This branch contains no production screenshot implementation and promotes no compatibility evidence.

Question: can SnapDOM preserve the useful parts of Playwright's screenshot API inside the current document?

Verdict: yes for the core capture flow. WebP belongs in the target. Several remaining options need integration work or renderer investigation, rather than blanket exclusion.

## Run

Open `src/screenshot.prototype.html` directly in a browser. It includes SnapDOM 3.2.0 and its MIT license, requires no server or dependency installation, and keeps captures in memory.

For the native Playwright comparison, start a persistent Devbox shell, install this branch's pinned dependencies, then run:

```sh
pnpm install --frozen-lockfile
node scripts/screenshot-prototype.mjs
```

The runner uses the existing Playwright Chromium installation. It records observations in `src/screenshot.prototype.observations.json` and saves both renderers' images under `output/playwright/screenshot-prototype/`. These are exploratory measurements, not a test suite or adapter execution evidence.

## Observed

SnapDOM 3.2.0; Playwright 1.62.1; Chromium 151.0.7922.34. The pinned Playwright source is commit `26a9e470a7b3c7822084b09fb7f13902c5f37b51`.

| Capability                      | Result on the prototype fixture                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewport and full-page capture  | Output dimensions match. Scrolled full-page capture needs an explicit document-coordinate rectangle, rather than an unbounded root capture.                                                                                              |
| Page clipping                   | The sampled rectangle matches in both unscrolled and scrolled documents. Edge clamping and invalid rectangles remain integration work.                                                                                                   |
| Locator-sized capture           | Document capture plus clipping preserves an overlapping sibling. Capturing only the target's subtree would not.                                                                                                                          |
| PNG, JPEG and WebP              | All encode and decode at the expected dimensions.                                                                                                                                                                                        |
| WebP quality 100                | After mapping to quality 1, the patterned canvas round-trips with zero changed channels, as PNG does. This verifies that fixture in Chromium, not every browser or input.                                                                |
| CSS and device scale            | Output dimensions match at DPR 1 and 2. Pixel rasterization still differs.                                                                                                                                                               |
| Background omission             | Transparent corner matches the native image.                                                                                                                                                                                             |
| Masks                           | A temporary rectangle overlay matches the fixture's native mask. Production could draw masks on the exported canvas to avoid adding elements to the live document.                                                                       |
| Temporary style                 | Works in the document and an open shadow root; the original background is restored after capture. The shadow-root fixture is pixel-identical.                                                                                            |
| Caret hiding                    | Pinned preparation hides the caret and restores the original inline value and priority. Input rendering still differs.                                                                                                                   |
| Caret preservation              | SnapDOM output is the same for hide/initial on the focused-input fixture, while native output differs. Missing visible caret paint is an accepted, documented limitation.                                                                |
| Animation disabling             | Pinned preparation finishes the finite animation and resumes the infinite one during cleanup. However, the finite animation's finished green background renders red in the capture. The live document is green. This remains unresolved. |
| Readable image                  | Captures successfully without warnings.                                                                                                                                                                                                  |
| Cross-origin image without CORS | The live document displays it; SnapDOM substitutes a placeholder and records `image-fallback`.                                                                                                                                           |
| Tainted canvas                  | The source throws `SecurityError` on pixel readback. SnapDOM returns a replacement image with an empty warnings list.                                                                                                                    |
| Standalone file                 | Opening the HTML through `file:` and clicking locator capture opens the preview successfully.                                                                                                                                            |

The images have expected dimensions, but are not pixel-identical in general. For this fixture, the unscrolled viewport differs at 1.84% of pixels; locator clipping differs at 0.05%. Font edges and browser painting can differ even when capture geometry is correct. These figures are measurements of one fixture, not general fidelity estimates.

## Integration target

The agreed direction is capture as partial compatibility, reject known capture degradation, and retain Playwright's existing public Page type and option names. SnapDOM remains an implementation detail. `toHaveScreenshot` and the filesystem `path` option are outside this work. Runtime binary values can follow the package's existing `Uint8Array` convention, documented as a difference from Node Buffer.

Start with Page viewport/fullPage/clip and shared Locator/ElementHandle capture; PNG/JPEG/WebP; quality; scale; background; default caret hiding; masks; and temporary styles. Reuse the adapter's selector resolution, visibility/stability checks, scroll-if-needed behavior, timeout controls and fonts-ready waiting. The prototype resolves selectors directly and unconditionally scrolls, so its locator behavior is not production parity.

Then investigate finished animation rendering, renderer error detection, and cancellation cleanup. Missing visible caret paint is accepted by the maintainer, rather than a blocker or an investigation requirement. SnapDOM exposes no capture AbortSignal. A promise race can reject the caller but does not stop the capture; temporary state must not be restored while pending capture work still reads it. A warnings-only check cannot enforce the agreed failure policy: the tainted-canvas probe demonstrates the hole, and source inspection finds similar silent fallbacks for some backgrounds, SVG images, video and frames.

Verify other browser engines, resource/font loading, CSP, asset reuse after changes, clipping validation, all mask geometries and cleanup before advertising support. The compiled distribution must separately prove that SnapDOM can load lazily and that capture does not add a required consumer setup step.

## Sources

- [Pinned screenshot orchestration and browser preparation](https://raw.githubusercontent.com/microsoft/playwright/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/screenshotter.ts). The HTML reuses the browser preparation function after stripping TypeScript annotations. Existing repository notices cover the pinned Playwright source; it is Apache-2.0.
- [Pinned Page screenshot tests](https://raw.githubusercontent.com/microsoft/playwright/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/page/page-screenshot.spec.ts) and [element screenshot tests](https://raw.githubusercontent.com/microsoft/playwright/26a9e470a7b3c7822084b09fb7f13902c5f37b51/tests/page/elementhandle-screenshot.spec.ts).
- [SnapDOM 3.2.0 exporter](https://raw.githubusercontent.com/zumerlab/snapdom/v3.2.0/src/exporters/toBlob.js) and [image fallbacks](https://raw.githubusercontent.com/zumerlab/snapdom/v3.2.0/src/modules/images.js).
- [Chromium WebP encoding](https://chromium.googlesource.com/chromium/src/+/0aee4434a4dba42a42abaea9bfbc0cd196a63bc1/third_party/blink/renderer/platform/image-encoders/image_encoder.cc): quality 1 selects lossless compression.
