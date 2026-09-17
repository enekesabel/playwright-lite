import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import { PageImpl } from "../../src/page";

describe("ElementHandle", () => {
  it("keeps page dollar results fixed while querying within their subtree", async () => {
    document.body.innerHTML =
      '<section id="root"><span class="child">before</span></section>';
    const page = createPage();
    const root = await page.$("#root");

    expect(root).toBeTruthy();
    if (!root) throw new Error("Expected root ElementHandle");
    expect(await page.$$(".child")).toHaveLength(1);
    await expect(
      root.$eval(".child", (element) => element.textContent)
    ).resolves.toBe("before");

    document.body.innerHTML = "";
    window.setTimeout(
      () => (document.body.innerHTML = '<p id="ready">ready</p>'),
      10
    );
    const waited = await page.waitForSelector("#ready", {
      state: "attached",
      timeout: 100,
    });
    if (!waited) throw new Error("Expected attached ElementHandle");
    await expect(waited.textContent()).resolves.toBe("ready");

    document.body.innerHTML =
      '<section id="root"><span class="child">after</span></section>';

    await expect(root.evaluate((element) => element.textContent)).resolves.toBe(
      "before"
    );
    await expect(
      root.$eval(".child", (element) => element.textContent)
    ).resolves.toBe("before");
  });

  it("returns fixed locator handle snapshots, distinguishes detached states, and releases disposed handles", async () => {
    document.body.innerHTML =
      '<input id="first" value="one"><input value="two">';
    const page = createPage();
    const handles = await page.locator("input").elementHandles();

    expect(handles).toHaveLength(2);
    expect(await handles[0].inputValue()).toBe("one");
    document.getElementById("first")!.remove();
    await expect(
      handles[0].waitForElementState("hidden", { timeout: 50 })
    ).resolves.toBeUndefined();
    await expect(
      handles[0].waitForElementState("visible", { timeout: 50 })
    ).rejects.toThrow("Element is not connected");
    await expect(
      handles[0].waitForElementState("enabled", { timeout: 50 })
    ).rejects.toThrow("Element is not connected");

    await handles[0].dispose();
    await expect(handles[0].dispose()).resolves.toBeUndefined();
    await expect(handles[0].textContent()).rejects.toThrow(/disposed/i);
  });

  it("bounds a stalled pinned stability check by the explicit timeout", async () => {
    document.body.innerHTML = '<div id="target"></div>';
    const page = PageImpl.fromWindow(window);
    const injected = (
      page as unknown as {
        actionableInjected: {
          checkElementStates: () => Promise<never>;
        };
      }
    ).actionableInjected;
    const checkElementStates = vi
      .spyOn(injected, "checkElementStates")
      .mockImplementation(() => new Promise<never>(() => {}));
    try {
      const target = await page.$("#target");

      if (!target) throw new Error("Expected target ElementHandle");
      const outcome = await Promise.race([
        target.waitForElementState("stable", { timeout: 25 }).then(
          () => "resolved",
          (error: unknown) => error
        ),
        new Promise((resolve) => window.setTimeout(resolve, 75, "pending")),
      ]);

      expect(outcome).toMatchObject({
        message: "elementHandle.waitForElementState: Timeout 25ms exceeded.",
      });
    } finally {
      checkElementStates.mockRestore();
    }
  });

  it("resolves Locator.elementHandle strictly as an attached fixed element", async () => {
    document.body.innerHTML = "<p>first</p><p>second</p>";
    const page = createPage();

    await expect(page.locator("p").elementHandle()).rejects.toThrow(
      /strict mode violation/
    );
    await expect(
      page.locator("p").first().elementHandle()
    ).resolves.toBeTruthy();
  });
});
