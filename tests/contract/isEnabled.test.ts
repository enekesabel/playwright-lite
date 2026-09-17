import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.isEnabled", () => {
  it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
    document.body.innerHTML = `
      <button id=enabled>Enabled</button>
    `;
    const page = createPage();

    expect(await page.locator("#enabled").isEnabled()).toBe(true);
  });
});

describe("Page.isEnabled", () => {
  it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
    document.body.innerHTML = `
      <button id=disabled disabled>Disabled</button>
    `;
    const page = createPage();

    expect(await page.isEnabled("#disabled")).toBe(false);
  });
});
