import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.toString", () => {
  it("renders readable strings and lets a pinned description win", () => {
    const page = createPage();
    const locator = page.getByRole("button", { name: "Save" });

    expect(locator.toString()).toBe("getByRole('button', { name: 'Save' })");
    expect(locator.describe("Save button").toString()).toBe("Save button");
  });

  // Contract coverage: upstream locator-convenience only prints `locator()`
  // chains and `getByRole` with `name`. Expected strings are what the pinned
  // client derives from the same selectors.
  it.each([
    [
      "filter by text",
      (page: ReturnType<typeof createPage>) =>
        page.locator("div").filter({ hasText: "x" }),
      "locator('div').filter({ hasText: 'x' })",
    ],
    [
      "role states",
      (page: ReturnType<typeof createPage>) =>
        page.getByRole("button", { disabled: true }),
      "getByRole('button', { disabled: true })",
    ],
    [
      "role name, exactness and level",
      (page: ReturnType<typeof createPage>) =>
        page.getByRole("heading", { name: "Title", exact: true, level: 2 }),
      "getByRole('heading', { name: 'Title', exact: true, level: 2 })",
    ],
    [
      "locator options",
      (page: ReturnType<typeof createPage>) =>
        page.locator("li", { hasNotText: /draft/i }).filter({ visible: true }),
      "locator('li').filter({ hasNotText: /draft/i }).filter({ visible: true })",
    ],
    [
      "nested locators",
      (page: ReturnType<typeof createPage>) =>
        page
          .locator("form")
          .filter({ has: page.getByText("Name") })
          .locator(page.getByLabel("Email", { exact: true }))
          .or(page.getByTestId("email")),
      "locator('form').filter({ has: getByText('Name') }).locator(getByLabel('Email', { exact: true })).or(getByTestId('email'))",
    ],
    [
      "first, last and nth",
      (page: ReturnType<typeof createPage>) =>
        page.locator("ul").first().locator("li").last().nth(2),
      "locator('ul').first().locator('li').last().nth(2)",
    ],
    [
      "an empty description",
      (page: ReturnType<typeof createPage>) => page.locator("div").describe(""),
      "locator('div')",
    ],
    [
      "a description followed by a filter",
      (page: ReturnType<typeof createPage>) =>
        page.locator("div").describe("x").filter({ hasText: "y" }),
      "locator('div').filter({ hasText: 'y' })",
    ],
  ])("prints %s like the pinned client", (_, build, expected) => {
    expect(build(createPage()).toString()).toBe(expected);
  });
});
