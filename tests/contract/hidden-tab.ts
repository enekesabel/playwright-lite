import { createPage, expect } from "../../src/index";

/**
 * The `hidden-tab` rule's cases: public members that must keep their
 * foreground pace while the document's tab is hidden, where the browser stops
 * animation frames and clamps timers. Playwright never sees a hidden page
 * because it launches the browser with background throttling off.
 *
 * `rules/hidden-tab.test.ts` runs them in Vitest's visible tab, and
 * `scripts/hidden-tab.mjs` runs them in a hidden one. Neither may import
 * Vitest here: the hidden tab is driven over raw CDP, outside its runner. Each
 * case sets up its own document and throws when the member misbehaves; budgets
 * sit well below what one throttled timer costs a hidden tab (about 1 s).
 */
export type HiddenTabCase = readonly [
  apiName: string,
  run: () => Promise<void>,
];

const actionTimeout = { timeout: 2_000 };

function setUp(html: string) {
  document.body.innerHTML = html;
  scrollTo(0, 0);
  return createPage();
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function within(budgetMs: number, run: () => Promise<unknown>) {
  const started = performance.now();
  await run();
  const elapsed = Math.round(performance.now() - started);
  check(elapsed < budgetMs, `took ${elapsed} ms, budget ${budgetMs} ms`);
}

/** Resolves with how long `run` took to reject. */
async function rejectionTime(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  const error = await run().then(
    () => undefined,
    (error: unknown) => error
  );
  check(error, "expected a rejection");
  return performance.now() - started;
}

function counted(selector: string, event: string) {
  let count = 0;
  document.querySelector(selector)!.addEventListener(event, () => void count++);
  return () => count;
}

const button = '<button id="target">Go</button>';

export const hiddenTabCases: readonly HiddenTabCase[] = [
  [
    "locator.click",
    async () => {
      const page = setUp(button);
      const clicks = counted("#target", "click");
      await page.locator("#target").click(actionTimeout);
      check(clicks() === 1, `clicked ${clicks()} times`);
    },
  ],
  [
    "locator.click (force)",
    async () => {
      const page = setUp(button);
      const clicks = counted("#target", "click");
      await page.locator("#target").click({ ...actionTimeout, force: true });
      check(clicks() === 1, `clicked ${clicks()} times`);
    },
  ],
  [
    "locator.click (trial)",
    async () => {
      const page = setUp(button);
      const clicks = counted("#target", "click");
      await page.locator("#target").click({ ...actionTimeout, trial: true });
      check(clicks() === 0, "a trial click dispatched a click");
    },
  ],
  [
    "locator.dblclick",
    async () => {
      const page = setUp(button);
      const doubleClicks = counted("#target", "dblclick");
      await page.locator("#target").dblclick(actionTimeout);
      check(doubleClicks() === 1, `double-clicked ${doubleClicks()} times`);
    },
  ],
  [
    "locator.hover",
    async () => {
      const page = setUp(button);
      const overs = counted("#target", "mouseover");
      await page.locator("#target").hover(actionTimeout);
      check(overs() > 0, "no mouseover");
    },
  ],
  [
    "locator.check",
    async () => {
      const page = setUp('<input type="checkbox" id="target">');
      await page.locator("#target").check(actionTimeout);
      check(
        document.querySelector<HTMLInputElement>("#target")!.checked,
        "not checked"
      );
    },
  ],
  [
    "locator.uncheck",
    async () => {
      const page = setUp('<input type="checkbox" id="target" checked>');
      await page.locator("#target").uncheck(actionTimeout);
      check(
        !document.querySelector<HTMLInputElement>("#target")!.checked,
        "still checked"
      );
    },
  ],
  [
    "locator.setChecked",
    async () => {
      const page = setUp('<input type="checkbox" id="target">');
      await page.locator("#target").setChecked(true, actionTimeout);
      check(
        document.querySelector<HTMLInputElement>("#target")!.checked,
        "not checked"
      );
    },
  ],
  [
    "locator.tap",
    async () => {
      // The browser reports touch support only when it is emulated or present.
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        value: 1,
      });
      try {
        const page = setUp(button);
        const taps = counted("#target", "click");
        await page.locator("#target").tap(actionTimeout);
        check(taps() === 1, `tapped ${taps()} times`);
      } finally {
        Reflect.deleteProperty(navigator, "maxTouchPoints");
      }
    },
  ],
  [
    "locator.dragTo",
    async () => {
      const page = setUp(
        '<div id="source" draggable="true" style="width:40px;height:40px">a</div>' +
          '<div id="drop" style="width:40px;height:40px">b</div>'
      );
      const drop = document.querySelector("#drop")!;
      drop.addEventListener("dragover", (event) => event.preventDefault());
      const drops = counted("#drop", "drop");
      await page
        .locator("#source")
        .dragTo(page.locator("#drop"), actionTimeout);
      check(drops() === 1, `dropped ${drops()} times`);
    },
  ],
  [
    "locator.scrollIntoViewIfNeeded",
    async () => {
      const page = setUp(`<div style="height:3000px"></div>${button}`);
      await page.locator("#target").scrollIntoViewIfNeeded(actionTimeout);
      check(scrollY > 0, "did not scroll");
    },
  ],
  [
    "locator.screenshot",
    async () => {
      const page = setUp(button);
      const image = await page.locator("#target").screenshot(actionTimeout);
      check(image.length > 0, "empty screenshot");
    },
  ],
  [
    "page.addLocatorHandler",
    async () => {
      const page = setUp(button);
      const clicks = counted("#target", "click");
      await page.addLocatorHandler(page.locator("#overlay"), async () => {});
      await page.locator("#target").click(actionTimeout);
      check(clicks() === 1, `clicked ${clicks()} times`);
    },
  ],
  [
    "locator.pressSequentially",
    async () => {
      const page = setUp('<input id="target">');
      await within(1_500, () =>
        page.locator("#target").pressSequentially("background", {
          ...actionTimeout,
          delay: 20,
        })
      );
      const value = document.querySelector<HTMLInputElement>("#target")!.value;
      check(value === "background", `typed ${JSON.stringify(value)}`);
    },
  ],
  [
    "locator.press (chord)",
    async () => {
      const page = setUp('<input id="target">');
      await within(1_000, () =>
        page.locator("#target").press("Shift+KeyA", actionTimeout)
      );
      const value = document.querySelector<HTMLInputElement>("#target")!.value;
      check(value === "A", `typed ${JSON.stringify(value)}`);
    },
  ],
  [
    "keyboard.type",
    async () => {
      const page = setUp('<input id="target">');
      document.querySelector<HTMLInputElement>("#target")!.focus();
      await within(1_500, () => page.keyboard.type("background"));
      const value = document.querySelector<HTMLInputElement>("#target")!.value;
      check(value === "background", `typed ${JSON.stringify(value)}`);
    },
  ],
  [
    "mouse.click",
    async () => {
      const page = setUp(button);
      const clicks = counted("#target", "click");
      const box = document.querySelector("#target")!.getBoundingClientRect();
      await within(1_000, () => page.mouse.click(box.x + 2, box.y + 2));
      check(clicks() === 1, `clicked ${clicks()} times`);
    },
  ],
  [
    "mouse.move",
    async () => {
      const page = setUp(button);
      await within(1_000, () => page.mouse.move(100, 100, { steps: 10 }));
    },
  ],
  [
    "page.waitForTimeout",
    async () => {
      const page = setUp("");
      await within(500, () => page.waitForTimeout(100));
    },
  ],
  [
    "page.waitForFunction (raf polling)",
    async () => {
      const page = setUp("");
      const state = window as { ready?: boolean };
      state.ready = false;
      setTimeout(() => (state.ready = true));
      await page.waitForFunction(
        () => (window as { ready?: boolean }).ready,
        undefined,
        { timeout: 2_000 }
      );
    },
  ],
  [
    "page.waitForFunction (interval polling)",
    async () => {
      const page = setUp("");
      const state = window as { ready?: boolean };
      state.ready = false;
      await within(800, async () => {
        const waiting = page.waitForFunction(
          () => (window as { ready?: boolean }).ready,
          undefined,
          { polling: 100, timeout: 2_000 }
        );
        state.ready = true;
        await waiting;
      });
    },
  ],
  [
    "expect(locator).toBeInViewport",
    async () => {
      const page = setUp(button);
      await expect(page.locator("#target")).toBeInViewport(actionTimeout);
    },
  ],
  [
    "expect(locator).not.toBeInViewport",
    async () => {
      const page = setUp(`<div style="height:3000px"></div>${button}`);
      await expect(page.locator("#target")).not.toBeInViewport(actionTimeout);
    },
  ],
  [
    "expect(locator).toHaveText",
    async () => {
      const page = setUp('<p id="target">before</p>');
      await within(1_200, async () => {
        setTimeout(() => {
          document.querySelector("#target")!.textContent = "after";
        }, 100);
        await expect(page.locator("#target")).toHaveText(
          "after",
          actionTimeout
        );
      });
    },
  ],
  [
    "expect.poll",
    async () => {
      setUp("");
      let calls = 0;
      await within(1_200, () =>
        expect.poll(() => ++calls, actionTimeout).toBe(3)
      );
    },
  ],
  [
    "locator.click (timeout)",
    async () => {
      const page = setUp('<button id="target" disabled>Off</button>');
      const elapsed = await rejectionTime(() =>
        page.locator("#target").click({ timeout: 1_000 })
      );
      check(elapsed < 1_500, `timed out after ${Math.round(elapsed)} ms`);
    },
  ],
  [
    "expect(locator).toBeHidden (timeout)",
    async () => {
      const page = setUp(button);
      const elapsed = await rejectionTime(() =>
        expect(page.locator("#target")).toBeHidden({ timeout: 1_000 })
      );
      check(elapsed < 1_500, `timed out after ${Math.round(elapsed)} ms`);
    },
  ],
];
