import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.isVisible", () => {
  it("reports editable, visible, and hidden state using InjectedScript", async () => {
    document.body.innerHTML = `
      <input id=editable />
      <div id=hidden hidden></div>
    `;
    const page = createPage();

    expect(await page.locator("#editable").isVisible()).toBe(true);
    expect(await page.locator("#hidden").isVisible()).toBe(false);
    expect(await page.locator("#missing").isVisible()).toBe(false);
  });

  it("retains the original implicit XPath in selector errors", async () => {
    const page = createPage();
    const selector = "//*[contains(@Class, 'foo']";
    const error = await page
      .locator(selector)
      .isVisible()
      .catch((error) => error);
    const expectedSelector = selector.replaceAll("'", "\\'");

    expect(error.message).toContain(expectedSelector);
    expect(error.message).not.toContain(`.${expectedSelector}`);
  });
});

describe("Page.isVisible", () => {
  it("delegates title and selector queries to the controlled document", async () => {
    document.body.innerHTML = `
      <div id=hidden hidden>Hidden</div>
      <div>First</div><div>Second</div>
    `;
    const page = createPage();

    await expect(page.isVisible("#missing")).resolves.toBe(false);
    await expect(page.isVisible("#hidden")).resolves.toBe(false);
    await expect(page.isVisible("div")).resolves.toBe(false);
    await expect(page.isVisible("div", { strict: true })).rejects.toThrow(
      "strict mode violation"
    );
  });
});
