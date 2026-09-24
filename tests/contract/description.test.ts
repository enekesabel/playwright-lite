import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

// Contract coverage: description() is synchronous, so the upstream bridge
// answers it in Node and the corpus never reaches the adapter's version.
describe("Locator.description", () => {
  it("is null until a description is pinned", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.description()).toBeNull();
  });

  it("reads the description from the selector's last part", () => {
    const page = createPage();
    const described = page.locator("div").describe("x");

    expect(page.locator("div").describe("").description()).toBeNull();
    expect(described.filter({}).description()).toBe("x");
    expect(described.filter({ hasText: "y" }).description()).toBeNull();
    expect(described.first().description()).toBeNull();
  });
});
