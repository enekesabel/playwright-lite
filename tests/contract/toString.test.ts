import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

// Contract coverage: toString() is synchronous, so the upstream bridge
// formats it in Node and the corpus never reaches the adapter's version.
// Expected strings are what the pinned client derives from the same selectors.
describe("Locator.toString", () => {
  it("renders readable strings and lets a pinned description win", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.toString()).toBe("getByRole('button', { name: 'Save' })");
    expect(locator.describe("Save button").toString()).toBe("Save button");
  });

  it.each([
    [
      "filter by text",
      (page: Page) => page.locator("div").filter({ hasText: "x" }),
      "locator('div').filter({ hasText: 'x' })",
    ],
    [
      "role states",
      (page: Page) => page.getByRole("button", { disabled: true }),
      "getByRole('button', { disabled: true })",
    ],
    [
      "role name, exactness and level",
      (page: Page) =>
        page.getByRole("heading", { name: "Title", exact: true, level: 2 }),
      "getByRole('heading', { name: 'Title', exact: true, level: 2 })",
    ],
    [
      "locator options",
      (page: Page) =>
        page.locator("li", { hasNotText: /draft/i }).filter({ visible: true }),
      "locator('li').filter({ hasNotText: /draft/i }).filter({ visible: true })",
    ],
    [
      "nested locators",
      (page: Page) =>
        page
          .locator("form")
          .filter({ has: page.getByText("Name") })
          .locator(page.getByLabel("Email", { exact: true }))
          .or(page.getByTestId("email")),
      "locator('form').filter({ has: getByText('Name') }).locator(getByLabel('Email', { exact: true })).or(getByTestId('email'))",
    ],
    [
      "first, last and nth",
      (page: Page) => page.locator("ul").first().locator("li").last().nth(2),
      "locator('ul').first().locator('li').last().nth(2)",
    ],
    [
      "an empty description",
      (page: Page) => page.locator("div").describe(""),
      "locator('div')",
    ],
    [
      "a description followed by a filter",
      (page: Page) =>
        page.locator("div").describe("x").filter({ hasText: "y" }),
      "locator('div').filter({ hasText: 'y' })",
    ],
  ])("prints %s like the pinned client", (_, build, expected) => {
    expect(build(createPage()).toString()).toBe(expected);
  });
});
