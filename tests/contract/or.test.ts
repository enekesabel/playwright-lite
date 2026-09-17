import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.or", () => {
  it("intersects and unions selectors using pinned serialization", async () => {
    document.body.innerHTML = `
      <button class=primary>Save</button>
      <button class=secondary>Cancel</button>
      <a class=primary>Save link</a>
    `;
    const page = createPage();
    const buttons = page.getByRole("button");
    const primary = page.locator(".primary");

    expect(await buttons.or(primary).allTextContents()).toEqual([
      "Save",
      "Cancel",
      "Save link",
    ]);
  });

  it("rejects locators from another page", () => {
    const first = createPage();
    const second = createPage();
    expect(() => first.locator("div").or(second.locator("div"))).toThrow(
      /same frame/
    );
  });
});
