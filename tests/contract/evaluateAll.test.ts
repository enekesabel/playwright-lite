/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.evaluateAll", () => {
  it("runs Locator callbacks through the pinned evaluation boundary", async () => {
    document.body.innerHTML = "<li>One</li><li>Two</li>";
    const page = createPage();
    const items = page.locator("li");

    await expect(
      items.evaluateAll((elements) =>
        elements.map((element) => element.textContent)
      )
    ).resolves.toEqual(["One", "Two"]);
  });
});

describe("Page.evaluateAll", () => {
  it("runs Page.$$eval against current-document elements", async () => {
    document.body.innerHTML = "<p>A</p><p>B</p>";
    const page = createPage();

    await expect(
      (page as any).$$eval("p", (elements: Element[]) =>
        elements.map((element) => element.textContent)
      )
    ).resolves.toEqual(["A", "B"]);
  });
});
