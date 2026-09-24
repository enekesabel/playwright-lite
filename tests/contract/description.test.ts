import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.description", () => {
  it("is null until a description is pinned", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.description()).toBeNull();
  });

  // Contract coverage: no upstream locator-convenience test describes a locator
  // with an empty string or filters a described locator.
  it("reads the description from the selector's last part", () => {
    const page = createPage();
    const described = page.locator("div").describe("x");

    expect(page.locator("div").describe("").description()).toBeNull();
    expect(described.filter({}).description()).toBe("x");
    expect(described.filter({ hasText: "y" }).description()).toBeNull();
    expect(described.first().description()).toBeNull();
  });
});
