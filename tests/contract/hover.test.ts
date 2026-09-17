import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.hover", () => {
  it("scrolls into view honoring modifiers and position", async () => {
    document.body.innerHTML =
      '<div style="height:120px;overflow:auto"><button style="margin-top:3000px">go</button></div>';
    const page = createPage();
    const container = document.querySelector("div")!;
    await page
      .locator("button")
      .hover({ modifiers: ["Shift"], position: { x: 4, y: 4 } });
    expect(container.scrollTop).toBeGreaterThan(0);
  });
});
