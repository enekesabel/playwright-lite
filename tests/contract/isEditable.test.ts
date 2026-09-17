import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.isEditable", () => {
  it("reports editable, visible, and hidden state using InjectedScript", async () => {
    document.body.innerHTML = `
      <input id=editable />
      <input id=readonly readonly />
      <div id=contenteditable contenteditable=true></div>
    `;
    const page = createPage();

    expect(await page.locator("#editable").isEditable()).toBe(true);
    expect(await page.locator("#readonly").isEditable()).toBe(false);
    expect(await page.locator("#contenteditable").isEditable()).toBe(true);
  });
});

describe("Page.isEditable", () => {
  it("delegates title and selector queries to the controlled document", async () => {
    document.body.innerHTML = `
      <input id=editable />
    `;
    const page = createPage();

    await expect(page.isEditable("#editable")).resolves.toBe(true);
  });
});
