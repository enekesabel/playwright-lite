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
});
