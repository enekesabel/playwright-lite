import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.last", () => {
  it("last() returns the last match", async () => {
    document.body.innerHTML = "<ul><li>A</li><li>B</li><li>C</li></ul>";
    const page = createPage();
    expect(await page.locator("li").last().count()).toBe(1);
  });
});
