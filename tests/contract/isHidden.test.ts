import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.isHidden", () => {
  it("reports editable, visible, and hidden state using InjectedScript", async () => {
    document.body.innerHTML = `
      <input id=editable />
      <div id=hidden hidden></div>
    `;
    const page = createPage();

    expect(await page.locator("#editable").isHidden()).toBe(false);
    expect(await page.locator("#hidden").isHidden()).toBe(true);
    expect(await page.locator("#missing").isHidden()).toBe(true);
  });
});

describe("Page.isHidden", () => {
  it("delegates title and selector queries to the controlled document", async () => {
    document.body.innerHTML = "";
    const page = createPage();

    await expect(page.isHidden("#missing")).resolves.toBe(true);
  });
});
