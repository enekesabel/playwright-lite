import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.allTextContents", () => {
  it("returns strict inner text and HTML plus all matching text values", async () => {
    document.body.innerHTML = `
      <div class=item><span>One</span></div>
      <div class=item><span>Two</span></div>
    `;
    const page = createPage();

    expect(await page.locator(".item").allTextContents()).toEqual([
      "One",
      "Two",
    ]);
  });
});
