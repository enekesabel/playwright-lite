import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.description", () => {
  it("is null until a description is pinned", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.description()).toBeNull();
  });
});
