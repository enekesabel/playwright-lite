import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.describe", () => {
  it("preserves pinned locator description precedence", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.describe("Save button").description()).toBe("Save button");
    expect(locator.describe("").description()).toBe("");
    expect(
      page
        .locator("form")
        .locator("input")
        .describe("Form input field")
        .description()
    ).toBe("Form input field");

    const first = page.locator("foo").describe("First description");
    const second = first.locator("button").describe("Second description");
    expect(first.description()).toBe("First description");
    expect(second.description()).toBe("Second description");
    expect(second.locator("button").description()).toBeNull();
  });
});
