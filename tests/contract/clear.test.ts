import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.clear", () => {
  it("clears an input", async () => {
    document.body.innerHTML = `<input id=input value=before />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").clear();

    expect(input.value).toBe("");
  });

  it("reports an injected rejection under its own member name", async () => {
    document.body.innerHTML = `<select><option>value1</option></select>`;
    const page = createPage();

    await expect(page.locator("select").clear()).rejects.toThrow(
      "locator.clear: Error: Element is not an <input>, <textarea> or [contenteditable] element\nCall log:"
    );
  });
});
