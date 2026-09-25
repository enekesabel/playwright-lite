import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.isClosed", () => {
  it("reports true from the close event on, for this page only", async () => {
    const page = createPage();
    const other = createPage();
    let duringClose: boolean | undefined;
    page.on("close", () => (duringClose = page.isClosed()));

    expect(page.isClosed()).toBe(false);
    await page.close();

    expect(duringClose).toBe(true);
    expect(page.isClosed()).toBe(true);
    expect(other.isClosed()).toBe(false);
  });
});
