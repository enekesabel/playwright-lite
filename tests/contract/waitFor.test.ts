/* eslint-disable @typescript-eslint/no-explicit-any -- intentional cast to spy on the internal query loop */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.waitFor", () => {
  it.each(["default", "explicit"] as const)(
    "waits with %s zero timeout, then stops querying",
    async (timeoutSource) => {
      document.body.innerHTML = "";
      const page = createPage();
      if (timeoutSource === "default") page.setDefaultTimeout(0);
      const resolveLocatorElement = (page as any).resolveLocatorElement.bind(
        page
      );
      let queries = 0;
      (page as any).resolveLocatorElement = (...args: any[]) => {
        queries++;
        return resolveLocatorElement(...args);
      };
      window.setTimeout(() => {
        document.body.innerHTML = '<div id="later">ready</div>';
      }, 10);

      await page
        .locator("#later")
        .waitFor(timeoutSource === "explicit" ? { timeout: 0 } : undefined);
      const settledQueries = queries;
      await page.waitForTimeout(75);

      expect(settledQueries).toBeGreaterThan(1);
      expect(queries).toBe(settledQueries);
    }
  );

  it("waits for insertion and removal with the existing strict polling loop", async () => {
    const page = createPage();
    const locator = page.locator("#target");
    const attached = locator.waitFor({ state: "attached", timeout: 1000 });
    document.body.innerHTML = '<div id="target" hidden></div>';
    await attached;

    let completed = false;
    const detached = locator
      .waitFor({ state: "detached", timeout: 1000 })
      .then(() => {
        completed = true;
      });
    await page.waitForTimeout(75);
    expect(completed).toBe(false);
    document.querySelector("#target")!.remove();
    await detached;
    expect(completed).toBe(true);
  });

  it.each(["attached", "detached"] as const)(
    "keeps %s waits strict",
    async (state) => {
      document.body.innerHTML =
        '<div class="target"></div><div class="target"></div>';
      await expect(
        createPage().locator(".target").waitFor({ state, timeout: 100 })
      ).rejects.toThrow("strict mode violation");
    }
  );

  it.each(["attached", "detached"] as const)(
    "honors the default timeout for %s",
    async (state) => {
      document.body.innerHTML =
        state === "detached" ? '<div id="target"></div>' : "";
      const page = createPage();
      page.setDefaultTimeout(30);
      await expect(page.locator("#target").waitFor({ state })).rejects.toThrow(
        "Timeout 30ms exceeded"
      );
    }
  );

  it("waitFor supports attached state even when hidden", async () => {
    document.body.innerHTML = "<div hidden>attached</div>";
    const page = createPage();
    await expect(
      page.locator("div").waitFor({ state: "attached" })
    ).resolves.toBeUndefined();
  });

  it("waitFor supports detached state", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    await expect(
      page.locator("div").waitFor({ state: "detached" })
    ).resolves.toBeUndefined();
  });

  it("waitFor defaults to visible state", async () => {
    document.body.innerHTML = "<div>visible</div>";
    const page = createPage();
    await page.locator("div").waitFor();
  });

  it("waitFor succeeds with supported options only", async () => {
    document.body.innerHTML = "<div>visible</div>";
    const page = createPage();
    await page.locator("div").waitFor({ state: "visible", timeout: 1000 });
  });

  it("keeps locator waitFor strict", async () => {
    document.body.innerHTML = `<div class=duplicate></div><div class=duplicate></div>`;
    const page = createPage();

    await expect(page.locator(".duplicate").waitFor()).rejects.toThrow(
      /strict mode violation/
    );
  });
});
