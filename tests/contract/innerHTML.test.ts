import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.innerHTML", () => {
  it("returns strict inner text and HTML plus all matching text values", async () => {
    document.body.innerHTML = `
      <div class=item><span>One</span></div>
      <div class=item><span>Two</span></div>
    `;
    const page = createPage();

    expect(await page.locator(".item").first().innerHTML()).toBe(
      "<span>One</span>"
    );
  });
});

describe("Page.innerHTML", () => {
  it("delegates title and selector queries to the controlled document", async () => {
    document.body.innerHTML = `
      <p id=copy>Hello <strong>world</strong></p>
    `;
    const page = createPage();

    await expect(page.innerHTML("#copy")).resolves.toBe(
      "Hello <strong>world</strong>"
    );
  });
});
