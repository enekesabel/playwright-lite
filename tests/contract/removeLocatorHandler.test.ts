import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { setupInterstitial } from "./locatorHandlers";

describe("Page.removeLocatorHandler", () => {
  it("stops calling the handlers registered for an equal locator", async () => {
    const { show, clicks } = setupInterstitial();
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.getByRole("button", { name: "Close" }),
      async (button) => {
        called++;
        await button.click();
      }
    );
    await page.locator("#target").click({ timeout: 1000 });
    show();

    await page.removeLocatorHandler(
      page.getByRole("button", { name: "Close" })
    );
    const error = await page
      .locator("#target")
      .click({ timeout: 300 })
      .catch((e: Error) => e);

    expect((error as Error).message).toContain("Timeout 300ms exceeded");
    expect(called).toBe(1);
    expect(clicks()).toBe(1);
  });

  it("rejects with the closed error after close()", async () => {
    const page = createPage();
    const locator = page.locator("div");
    await page.addLocatorHandler(locator, async () => {});
    await page.close();

    await expect(page.removeLocatorHandler(locator)).rejects.toThrow(
      "page.removeLocatorHandler: Target page, context or browser has been closed"
    );
  });

  it("keeps the handlers of other locators", async () => {
    const { clicks } = setupInterstitial();
    const page = createPage();
    let called = 0;
    await page.addLocatorHandler(
      page.getByRole("button", { name: "Close" }),
      async (button) => {
        called++;
        await button.click();
      }
    );

    await page.removeLocatorHandler(page.locator("#close"));
    await page.locator("#target").click({ timeout: 1000 });

    expect(called).toBe(1);
    expect(clicks()).toBe(1);
  });
});
