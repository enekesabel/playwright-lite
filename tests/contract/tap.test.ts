import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { emulateTouch } from "./touch";

let listeners = new AbortController();

afterEach(() => {
  listeners.abort();
  listeners = new AbortController();
  document.body.innerHTML = "";
});

/** Each of `types` the adapter fires on the document, as `type@id`, until the test ends. */
function record(types: string[]) {
  const log: string[] = [];
  for (const type of types)
    document.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted)
          log.push(`${type}@${(event.target as Element).id}`);
      },
      { signal: listeners.signal }
    );
  return log;
}

describe("Locator.tap", () => {
  // Contract coverage: the pinned hasTouch test lives in
  // browsercontext-viewport.spec.ts, which the corpus cannot load.
  it("rejects without touch points, with Playwright's tap error", async () => {
    document.body.innerHTML = "<button id=a>a</button>";
    const page = createPage();
    const log = record(["pointerdown", "touchstart", "click"]);

    await expect(page.locator("#a").tap()).rejects.toThrow(
      "locator.tap: The page does not support tap. Use hasTouch context option to enable touch support."
    );
    expect(log).toEqual([]);
  });

  // Contract coverage: the pinned test that waits for a hidden element taps
  // an ElementHandle and never waits for enabled.
  it("waits until the element is visible and enabled, then taps it", async () => {
    emulateTouch();
    document.body.innerHTML =
      '<button id=a disabled style="display: none">a</button>';
    const page = createPage();
    const button = document.querySelector("button")!;
    const log = record(["touchstart", "click"]);

    const tapping = page.locator("#a").tap();
    await new Promise((resolve) => setTimeout(resolve, 50));
    button.style.display = "block";
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual([]);
    button.disabled = false;
    await tapping;

    expect(log).toEqual(["touchstart@a", "click@a"]);
  });

  // Contract coverage: no pinned tap test covers the tap point.
  it("retries while another element receives the tap point, and taps through it with force", async () => {
    emulateTouch();
    document.body.innerHTML = `
      <button id=a style="position: absolute; left: 10px; top: 10px; width: 80px; height: 40px">a</button>
      <div id=cover style="position: absolute; left: 0; top: 0; width: 200px; height: 100px"></div>`;
    const page = createPage();
    const log = record(["touchstart", "click"]);

    await page.locator("#a").tap({ force: true });
    await expect(page.locator("#a").tap({ timeout: 300 })).rejects.toThrow(
      /Timeout 300ms exceeded.*<div id="cover"><\/div> intercepts pointer events/s
    );
    setTimeout(() => document.getElementById("cover")!.remove(), 50);
    await page.locator("#a").tap();

    expect(log).toEqual([
      "touchstart@cover",
      "click@cover",
      "touchstart@a",
      "click@a",
    ]);
  });

  // Contract coverage: no pinned tap test passes `position`.
  it("taps at `position` relative to the element", async () => {
    emulateTouch();
    document.body.innerHTML =
      '<div id=a style="position: absolute; left: 10px; top: 20px; width: 80px; height: 40px"></div>';
    const page = createPage();
    const points: string[] = [];
    document.addEventListener(
      "touchstart",
      (event) =>
        points.push(`${event.touches[0].clientX},${event.touches[0].clientY}`),
      { once: true }
    );

    await page.locator("#a").tap({ position: { x: 5, y: 7 } });

    expect(points).toEqual(["15,27"]);
  });
});

describe("Page.tap", () => {
  // Contract coverage: as for Locator.tap, under the Page's name.
  it("rejects without touch points, with Playwright's tap error", async () => {
    document.body.innerHTML = "<button id=a>a</button>";
    const page = createPage();

    await expect(page.tap("#a")).rejects.toThrow(
      "page.tap: The page does not support tap. Use hasTouch context option to enable touch support."
    );
  });
});
