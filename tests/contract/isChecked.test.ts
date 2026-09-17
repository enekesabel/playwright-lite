import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.isChecked", () => {
  it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
    document.body.innerHTML = `
      <input id=checkbox type=checkbox checked />
      <input id=unchecked-radio type=radio />
    `;
    const page = createPage();

    expect(await page.locator("#checkbox").isChecked()).toBe(true);
    expect(await page.locator("#unchecked-radio").isChecked()).toBe(false);
  });

  it("reads checked state and geometry through a fixed ElementHandle", async () => {
    document.body.innerHTML = `
      <input id=checkbox type=checkbox checked
        style="appearance: none; border: 0; margin: 0; padding: 0; position: fixed; left: 10px; top: 20px; width: 100px; height: 40px" />
    `;
    const page = createPage();
    const handle = await page.$("#checkbox");

    expect(handle).not.toBeNull();
    expect(await handle!.isChecked()).toBe(true);
  });

  it("rejects invalid input-value and checked targets without retrying", async () => {
    document.body.innerHTML = "<div></div><input type=text />";
    const page = createPage();

    await expect(page.locator("input").isChecked()).rejects.toThrow(
      "Not a checkbox or radio button"
    );
  });
});

describe("Page.isChecked", () => {
  it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
    document.body.innerHTML = `
      <input id=radio type=radio checked />
    `;
    const page = createPage();

    expect(await page.isChecked("#radio")).toBe(true);
  });

  it("rejects invalid input-value and checked targets without retrying", async () => {
    document.body.innerHTML = "<div></div><input type=text />";
    const page = createPage();

    await expect(page.isChecked("div")).rejects.toThrow(
      "Not a checkbox or radio button"
    );
  });
});
