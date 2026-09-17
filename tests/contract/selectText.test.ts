import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.selectText", () => {
  it("selects the full text content of an input", async () => {
    document.body.innerHTML = `<input id=input value=hello />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").selectText();

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  // Pinned dom.ts `selectText` runs `checkElementStates(['visible'])` only
  // when `force` is unset.
  it("skips the visible wait with force", async () => {
    document.body.innerHTML = `<input id=input value=hello style="display:none" />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await expect(
      page.locator("#input").selectText({ timeout: 20 })
    ).rejects.toThrow(/Timeout 20ms exceeded/);
    await page.locator("#input").selectText({ force: true });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });
});
