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

  // `clear` is the pinned `fill("")`, so `force` skips the same state wait.
  // The date input keeps the assertion on InjectedScript's direct set-value
  // path, which completes without any keyboard input of its own.
  it("clears a hidden input with force", async () => {
    document.body.innerHTML = `<input id=input type=date value=2020-01-01 style="display:none">`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await expect(page.locator("#input").clear({ timeout: 20 })).rejects.toThrow(
      /Timeout 20ms exceeded/
    );
    await page.locator("#input").clear({ force: true });

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
