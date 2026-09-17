import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.toString", () => {
  it("renders readable strings and lets a pinned description win", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.toString()).toBe("getByRole('button', { name: 'Save' })");
    expect(locator.describe("Save button").toString()).toBe("Save button");
  });
});
