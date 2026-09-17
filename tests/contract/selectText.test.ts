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
});
