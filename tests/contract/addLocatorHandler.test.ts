import { describe, expect as vitestExpect, it, vi } from "vitest";
import type { Locator, Page } from "@playwright/test";

import { createPage, expect } from "../../src/index";
import { interstitialText, setupInterstitial } from "./locatorHandlers";

describe("Page.addLocatorHandler", () => {
  it("calls the handler with the registered locator before the action, then performs the action", async () => {
    const { interstitial, clicks } = setupInterstitial();
    const page = createPage();
    const covering = page.getByText(interstitialText);
    const received: Locator[] = [];
    await page.addLocatorHandler(covering, async (locator) => {
      received.push(locator);
      // Runs inside the handler, so it does not re-enter the handler.
      await page.locator("#close").click();
    });

    await page.locator("#target").click({ timeout: 2000 });

    vitestExpect(received).toHaveLength(1);
    vitestExpect(received[0]).toBe(covering);
    vitestExpect(clicks()).toBe(1);
    vitestExpect(interstitial.style.display).toBe("none");
  });

  it("waits for the locator to be hidden after the handler before retrying", async () => {
    const { clicks } = setupInterstitial(300);
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.getByRole("button", { name: "Close" }),
      async (button) => {
        called++;
        await button.click();
      }
    );

    await page.locator("#target").click({ timeout: 2000 });

    vitestExpect(called).toBe(1);
    vitestExpect(clicks()).toBe(1);
  });

  it("times out with the wait for hidden in the call log when the locator stays visible", async () => {
    const { clicks } = setupInterstitial();
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.getByRole("button", { name: "Close" }),
      async () => {
        called++;
      }
    );

    const error = await page
      .locator("#target")
      .click({ timeout: 500 })
      .catch((e: Error) => e);

    vitestExpect(error).toBeInstanceOf(Error);
    vitestExpect((error as Error).message).toContain("Timeout 500ms exceeded");
    vitestExpect((error as Error).message).toContain(
      "locator handler has finished, waiting for getByRole('button', { name: 'Close' }) to be hidden"
    );
    vitestExpect(called).toBe(1);
    vitestExpect(clicks()).toBe(0);
  });

  it("with noWaitAfter, retries right after the handler and calls it again while the locator is visible", async () => {
    const { clicks } = setupInterstitial(300);
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.getByRole("button", { name: "Close" }),
      async (button) => {
        called++;
        if (called === 1) await button.click();
        else await page.locator("#interstitial").waitFor({ state: "hidden" });
      },
      { noWaitAfter: true }
    );

    await page.locator("#target").click({ timeout: 2000 });

    vitestExpect(called).toBe(2);
    vitestExpect(clicks()).toBe(1);
  });

  it("with times, stops calling the handler after that many calls", async () => {
    const { clicks } = setupInterstitial();
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.locator("body"),
      async () => {
        called++;
      },
      { noWaitAfter: true, times: 2 }
    );

    const error = await page
      .locator("#target")
      .click({ timeout: 500 })
      .catch((e: Error) => e);
    await page
      .locator("#target")
      .click({ timeout: 200 })
      .catch(() => {});

    vitestExpect((error as Error).message).toContain("Timeout 500ms exceeded");
    vitestExpect((error as Error).message).toContain(
      "intercepts pointer events"
    );
    vitestExpect(called).toBe(2);
    vitestExpect(clicks()).toBe(0);
  });

  it("registers nothing for times: 0", async () => {
    setupInterstitial();
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.getByText(interstitialText),
      async () => {
        called++;
      },
      { times: 0 }
    );

    await page
      .locator("#target")
      .click({ timeout: 200 })
      .catch(() => {});

    vitestExpect(called).toBe(0);
  });

  it("does not call a handler again while it is still running", async () => {
    setupInterstitial();
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(page.getByText(interstitialText), async () => {
      ++called;
      await new Promise(() => {});
    });

    const first = await page
      .locator("#target")
      .click({ timeout: 300 })
      .catch((e: Error) => e);
    const second = await page
      .locator("#target")
      .click({ timeout: 300 })
      .catch((e: Error) => e);

    vitestExpect((first as Error).message).toContain("Timeout 300ms exceeded");
    vitestExpect((second as Error).message).toContain("Timeout 300ms exceeded");
    vitestExpect(called).toBe(1);
  });

  it("runs before locator assertion retries", async () => {
    document.body.innerHTML = `
      <div id="overlay">Overlay</div>
      <div id="target" style="display: none">Target</div>`;
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(page.locator("#overlay"), async () => {
      called++;
      document.querySelector<HTMLElement>("#overlay")!.remove();
      document.querySelector<HTMLElement>("#target")!.style.display = "";
    });

    await expect(page.locator("#target")).toBeVisible({ timeout: 1000 });

    vitestExpect(called).toBe(1);
  });

  it("runs before page assertion retries", async () => {
    document.body.innerHTML = `<div id="overlay">Overlay</div>`;
    const title = document.title;
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(page.locator("#overlay"), async () => {
      called++;
      document.title = "handled";
      document.querySelector("#overlay")!.remove();
    });

    try {
      await expect(page).toHaveTitle("handled", { timeout: 1000 });
    } finally {
      document.title = title;
    }

    vitestExpect(called).toBe(1);
  });

  it.each([
    [
      "expect(locator)",
      (page: Page) =>
        expect(page.locator("#missing")).toBeVisible({ timeout: 1000 }),
    ],
    [
      "expect(page)",
      (page: Page) => expect(page).toHaveTitle("never", { timeout: 1000 }),
    ],
  ] as const)(
    "keeps %s on one deadline when a handler uses most of the timeout",
    async (_assertion, assert) => {
      document.body.innerHTML = `<div id="overlay">Overlay</div>`;
      const page = createPage();
      await page.addLocatorHandler(page.locator("#overlay"), async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        document.querySelector("#overlay")!.remove();
      });

      const started = Date.now();
      const error = await assert(page).catch((e: Error) => e);
      const elapsed = Date.now() - started;

      vitestExpect(error).toBeInstanceOf(Error);
      vitestExpect(elapsed).toBeGreaterThanOrEqual(950);
      vitestExpect(elapsed).toBeLessThan(1400);
    }
  );

  it("logs a handler that throws with console.error and continues the action", async () => {
    const logged = vi
      .spyOn(window.console, "error")
      .mockImplementation(() => {});
    try {
      const { clicks, interstitial } = setupInterstitial();
      const page = createPage();
      const failure = new Error("handler failed on purpose");
      await page.addLocatorHandler(page.getByText(interstitialText), () => {
        interstitial.style.display = "none";
        throw failure;
      });

      await page.locator("#target").click({ timeout: 1000 });

      vitestExpect(clicks()).toBe(1);
      vitestExpect(logged).toHaveBeenCalledWith(
        `page.addLocatorHandler(getByText('${interstitialText}')): handler failed`,
        failure
      );
    } finally {
      logged.mockRestore();
    }
  });

  it("fails the action with a strict mode violation when the handler's locator matches two elements", async () => {
    document.body.innerHTML = `<div class="dup">a</div><div class="dup">b</div><button id="b">b</button>`;
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(page.locator(".dup"), async () => {
      called++;
    });

    await vitestExpect(
      page.locator("#b").click({ timeout: 500 })
    ).rejects.toThrow(
      "strict mode violation: locator('.dup') resolved to 2 elements"
    );
    vitestExpect(called).toBe(0);
  });

  it.each([
    ["check", true],
    ["uncheck", false],
    ["setChecked", true],
  ] as const)(
    "runs the handler before %s even when the box already has that state",
    async (method, checked) => {
      document.body.innerHTML = `
        <div id="overlay">Overlay</div>
        <input id="box" type="checkbox"${checked ? " checked" : ""}>`;
      const page = createPage();
      let called = 0;
      await page.addLocatorHandler(page.locator("#overlay"), async () => {
        called++;
        document.querySelector("#overlay")!.remove();
      });

      const box = page.locator("#box");
      await (method === "setChecked" ? box.setChecked(checked) : box[method]());

      vitestExpect(called).toBe(1);
      vitestExpect(
        document.querySelector<HTMLInputElement>("#box")!.checked
      ).toBe(checked);
    }
  );

  it("rejects with the closed error after close()", async () => {
    const page = createPage();
    const locator = page.locator("div");
    await page.close();

    await vitestExpect(
      page.addLocatorHandler(locator, async () => {})
    ).rejects.toThrow(
      "page.addLocatorHandler: Target page, context or browser has been closed"
    );
  });

  it("rejects a locator of another page", async () => {
    document.body.innerHTML = `<div>content</div>`;
    const page = createPage();
    const other = createPage();

    await vitestExpect(
      page.addLocatorHandler(other.locator("div"), async () => {})
    ).rejects.toThrow("Locator must belong to the main frame of this page");
  });

  it("rejects a non-boolean noWaitAfter", async () => {
    const page = createPage();

    await vitestExpect(
      page.addLocatorHandler(page.locator("div"), async () => {}, {
        noWaitAfter: "yes" as unknown as boolean,
      })
    ).rejects.toThrow("noWaitAfter: expected boolean, got string");
  });

  type MemberCase = [apiName: string, run: (page: Page) => Promise<unknown>];
  // Pinned server/frames.ts and server/dom.ts run the handlers before every
  // attempt of these members.
  const running: MemberCase[] = [
    ["Locator.click", (page) => page.locator("#button").click()],
    ["Locator.dblclick", (page) => page.locator("#button").dblclick()],
    ["Locator.hover", (page) => page.locator("#button").hover()],
    ["Locator.check", (page) => page.locator("#checkbox").check()],
    ["Locator.fill", (page) => page.locator("#field").fill("text")],
    ["Locator.clear", (page) => page.locator("#field").clear()],
    [
      "Locator.selectOption",
      (page) => page.locator("#select").selectOption("b"),
    ],
    ["Locator.selectText", (page) => page.locator("#field").selectText()],
    ["Locator.focus", (page) => page.locator("#field").focus()],
    ["Locator.blur", (page) => page.locator("#field").blur()],
    ["Locator.press", (page) => page.locator("#field").press("a")],
    [
      "Locator.pressSequentially",
      (page) => page.locator("#field").pressSequentially("a"),
    ],
    [
      "Locator.setInputFiles",
      (page) =>
        page.locator("#file").setInputFiles({
          name: "a.txt",
          mimeType: "text/plain",
          buffer: new Uint8Array() as never,
        }),
    ],
    [
      "Locator.scrollIntoViewIfNeeded",
      (page) => page.locator("#button").scrollIntoViewIfNeeded(),
    ],
    ["Locator.boundingBox", (page) => page.locator("#button").boundingBox()],
    ["Locator.evaluate", (page) => page.locator("#button").evaluate(() => 1)],
    ["Locator.ariaSnapshot", (page) => page.locator("#button").ariaSnapshot()],
    [
      "Locator.elementHandle",
      (page) => page.locator("#button").elementHandle(),
    ],
    ["Locator.waitFor", (page) => page.locator("#button").waitFor()],
    ["Page.waitForSelector", (page) => page.waitForSelector("#button")],
    ["ElementHandle.click", async (page) => (await page.$("#button"))!.click()],
    [
      "ElementHandle.waitForElementState",
      async (page) => (await page.$("#button"))!.waitForElementState("visible"),
    ],
  ];
  // These never run them in the pinned implementation.
  const notRunning: MemberCase[] = [
    [
      "Locator.dispatchEvent",
      (page) => page.locator("#button").dispatchEvent("click"),
    ],
    ["Locator.textContent", (page) => page.locator("#button").textContent()],
    ["Locator.isVisible", (page) => page.locator("#button").isVisible()],
    [
      "Locator.evaluateAll",
      (page) => page.locator("#button").evaluateAll(() => 1),
    ],
    [
      "ElementHandle.press",
      async (page) => (await page.$("#field"))!.press("a"),
    ],
  ];
  const members = [
    ...running.map(([apiName, run]) => [apiName, true, run] as const),
    ...notRunning.map(([apiName, run]) => [apiName, false, run] as const),
  ];

  it.each(members)(
    "%s runs the handlers before its attempts: %s",
    async (_apiName, runsHandlers, run) => {
      document.body.innerHTML = `
        <div id="overlay">Overlay</div>
        <button id="button">Button</button>
        <input id="field" value="value">
        <input id="checkbox" type="checkbox">
        <input id="file" type="file">
        <select id="select"><option>a</option><option>b</option></select>`;
      const page = createPage();
      let called = 0;
      await page.addLocatorHandler(page.locator("#overlay"), async () => {
        called++;
        document.querySelector("#overlay")!.remove();
      });

      await run(page);

      vitestExpect(called).toBe(runsHandlers ? 1 : 0);
    }
  );
});
