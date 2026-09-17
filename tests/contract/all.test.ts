import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.all", () => {
  it("Locator.all captures the length, not the resolved elements", async () => {
    document.body.innerHTML = "<ul><li>old</li></ul>";
    const locators = await createPage().locator("li").all();
    document.querySelector("ul")!.innerHTML = "<li>new</li><li>extra</li>";
    expect(locators).toHaveLength(1);
    expect(await locators[0]!.textContent()).toBe("new");
  });
});
