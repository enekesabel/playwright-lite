import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.isDisabled", () => {
  it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
    document.body.innerHTML = `
      <button id=disabled disabled>Disabled</button>
    `;
    const page = createPage();

    expect(await page.locator("#disabled").isDisabled()).toBe(true);
  });
});

describe("Page.isDisabled", () => {
  it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
    document.body.innerHTML = `
      <button id=enabled>Enabled</button>
    `;
    const page = createPage();

    expect(await page.isDisabled("#enabled")).toBe(false);
  });
});
