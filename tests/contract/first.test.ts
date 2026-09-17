import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.first", () => {
  it("first() returns the first match", async () => {
    document.body.innerHTML = "<ul><li>A</li><li>B</li><li>C</li></ul>";
    const page = createPage();
    expect(await page.locator("li").first().count()).toBe(1);
  });
});
