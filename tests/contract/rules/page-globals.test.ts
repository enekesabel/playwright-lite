import { pageGlobalNames } from "virtual:playwright-lite-globals";
import { afterEach, describe, expect, it } from "vitest";

import type { createPage } from "../../../src/index";

type Page = ReturnType<typeof createPage>;
type FrameWindow = Window &
  typeof globalThis & { createPage?: typeof createPage };

let frame: HTMLIFrameElement | undefined;

afterEach(() => {
  frame?.remove();
  frame = undefined;
});

/**
 * The adapter, loaded as a module of its own in a same-origin frame showing
 * `body`. The test runner shares the test's realm and needs these globals
 * itself, so the page changing them is the frame's.
 */
async function adapterFrame(body: string): Promise<FrameWindow> {
  frame = document.createElement("iframe");
  frame.srcdoc = `${body}<script type="module">
    import { createPage } from "/src/index.ts";
    window.createPage = createPage;
  </script>`;
  document.body.appendChild(frame);
  const frameWindow = frame.contentWindow as FrameWindow;
  await expect
    .poll(() => frameWindow.createPage, { timeout: 10_000 })
    .toBeTruthy();
  return frameWindow;
}

/** Deletes or replaces every kept global of `frameWindow`, as a page script can. */
function changeGlobals(
  frameWindow: FrameWindow,
  change: "deleted" | "replaced"
) {
  const host = frameWindow as unknown as Record<string, unknown>;
  for (const name of pageGlobalNames) {
    if (change === "deleted") delete host[name];
    else host[name] = "foo";
  }
}

const markup = `
  <button onclick="document.body.dataset.clicked = 'yes'">Go</button>
  <input>
  <select><option>first</option><option>second</option></select>
  <ul><li>one</li><li>two</li></ul>`;

/** Settled into this realm: the frame's values have the frame's prototypes. */
function settle(result: Promise<unknown>) {
  return result.then(
    (value) => ({ value: structuredClone(value) }),
    (error: unknown) => ({ error: String(error) })
  );
}

// Contract coverage: the corpus deletes one global per test (`Node` for click
// and fill, `Event` for selectOption, `MutationObserver` for waitForSelector),
// its deleted-`Map` count and overridden-`URL`/`Date`/`RegExp` evaluate tests
// stop at the harness transport and at a mid-test navigation, and no spec
// replaces a global with a working one.
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
    for (const [apiName, run, expected] of cases) {
      it(`${apiName} after the page ${change} every kept global`, async () => {
        const frameWindow = await adapterFrame(markup);
        const page = frameWindow.createPage!();
        changeGlobals(frameWindow, change);
        expect(await settle(run(page, frameWindow))).toEqual({
          value: expected,
        });
      });
    }
  }

  it("uses a working replacement the page made before createPage()", async () => {
    const frameWindow = await adapterFrame(markup);
    const constructed: string[] = [];
    const PageEvent = frameWindow.Event;
    frameWindow.Event = class extends PageEvent {
      constructor(type: string, init?: EventInit) {
        super(type, init);
        constructed.push(type);
      }
    };
    const page = frameWindow.createPage!();
    expect(await settle(page.locator("select").selectOption("second"))).toEqual(
      { value: ["second"] }
    );
    expect(constructed).toEqual(["input", "change"]);
  });

  it("uses the global as it was when the adapter loaded once the page's is no longer valid", async () => {
    const frameWindow = await adapterFrame(markup);
    changeGlobals(frameWindow, "replaced");
    const page = frameWindow.createPage!();
    expect(await settle(page.locator("li").count())).toEqual({ value: 2 });
  });
});
