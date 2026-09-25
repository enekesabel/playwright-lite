import { afterEach, describe, expect, it } from "vitest";

import type { createPage } from "../../../src/index";

/** The globals the README's "Page globals" section says survive a page change. */
const keptGlobals = [
  "Node",
  "Element",
  "NodeFilter",
  "HTMLElement",
  "Document",
  "ShadowRoot",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "EventTarget",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Symbol",
  "Error",
  "TypeError",
  "RegExp",
  "Array",
  "Object",
  "JSON",
  "Math",
  "URL",
  "Date",
] as const;

type Page = ReturnType<typeof createPage>;
type FrameWindow = Window & typeof globalThis & { page?: Page };

let frame: HTMLIFrameElement | undefined;

afterEach(() => {
  frame?.remove();
  frame = undefined;
});

/**
 * The adapter, loaded as a module of its own in a same-origin frame, with a
 * `Page` for that frame's window. The test runner shares the test's realm and
 * needs these globals itself, so the page changing them is the frame's.
 */
async function adapterFrame(body: string): Promise<FrameWindow> {
  frame = document.createElement("iframe");
  frame.srcdoc = `${body}<script type="module">
    import { createPage } from "/src/index.ts";
    window.page = createPage();
  </script>`;
  document.body.appendChild(frame);
  const frameWindow = frame.contentWindow as FrameWindow;
  await expect.poll(() => frameWindow.page, { timeout: 10_000 }).toBeTruthy();
  return frameWindow;
}

/** Deletes or replaces every kept global of `frameWindow`, as a page script can. */
function changeGlobals(
  frameWindow: FrameWindow,
  change: "deleted" | "replaced"
) {
  const host = frameWindow as unknown as Record<string, unknown>;
  for (const name of keptGlobals) {
    if (change === "deleted") delete host[name];
    else host[name] = "foo";
  }
}

// Contract coverage: the corpus deletes one global per test (`Node` for click
// and fill, `Event` for selectOption, `MutationObserver` for waitForSelector),
// and its deleted-`Map` count and overridden-`URL`/`Date`/`RegExp` evaluate
// tests stop at the harness transport and at a mid-test navigation.
describe("page globals", () => {
  const cases: [
    string,
    (page: Page, frameWindow: FrameWindow) => Promise<unknown>,
    unknown,
  ][] = [
    [
      "locator.click",
      async (page, frameWindow) => {
        await page.locator("button").click();
        return frameWindow.document.body.dataset.clicked;
      },
      "yes",
    ],
    [
      "locator.fill",
      async (page, frameWindow) => {
        await page.locator("input").fill("typed");
        return frameWindow.document.querySelector("input")!.value;
      },
      "typed",
    ],
    [
      "locator.selectOption",
      (page) => page.locator("select").selectOption("second"),
      ["second"],
    ],
    [
      "page.waitForSelector",
      async (page, frameWindow) => {
        frameWindow.setTimeout(() => {
          frameWindow.document.body.insertAdjacentHTML(
            "beforeend",
            "<p class=late>late</p>"
          );
        }, 50);
        const handle = await page.waitForSelector(".late");
        return handle && (await handle.textContent());
      },
      "late",
    ],
    ["locator.count", (page) => page.locator("li").count(), 2],
    [
      "page.evaluate",
      (page) => page.evaluate((year) => ({ year, list: ["a", 1] }), 2023),
      { year: 2023, list: ["a", 1] },
    ],
  ];

  for (const change of ["deleted", "replaced"] as const) {
    it(`${change} globals do not reach the adapter`, async () => {
      for (const [apiName, run, expected] of cases) {
        const frameWindow = await adapterFrame(`
          <button onclick="document.body.dataset.clicked = 'yes'">Go</button>
          <input>
          <select><option>first</option><option>second</option></select>
          <ul><li>one</li><li>two</li></ul>`);
        changeGlobals(frameWindow, change);
        // Copied into this realm before asserting: the frame's values have
        // the frame's prototypes.
        const outcome = await run(frameWindow.page!, frameWindow).then(
          (value) => ({ value: structuredClone(value) }),
          (error: unknown) => ({ error: String(error) })
        );
        expect(outcome, apiName).toEqual({ value: expected });
        frame!.remove();
      }
    });
  }
});
