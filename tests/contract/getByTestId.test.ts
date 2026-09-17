import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.getByTestId", () => {
  it("uses custom test IDs for Page and chained Locator queries", async () => {
    document.body.innerHTML =
      '<section data-test="panel"><button data-test="save">Save</button></section>';
    const page = createPage({ testIdAttribute: "data-test" });
    expect(await page.getByTestId("save").count()).toBe(1);
    expect(await page.getByTestId("panel").getByTestId("save").count()).toBe(1);
  });

  it("does not leak configuration between pages or existing locators", async () => {
    document.body.innerHTML =
      '<section><button data-a="save">A</button><button data-b="save">B</button><button data-testid="save">Default</button></section>';
    const first = createPage({ testIdAttribute: "data-a" });
    const existing = first.locator("section");
    const second = createPage({ testIdAttribute: "data-b" });
    expect(await first.getByTestId("save").textContent()).toBe("A");
    expect(await second.getByTestId("save").textContent()).toBe("B");
    expect(await existing.getByTestId("save").textContent()).toBe("A");
    expect(await createPage().getByTestId("save").textContent()).toBe(
      "Default"
    );
    await createPage().ariaSnapshot();
    expect(await first.getByTestId("save").textContent()).toBe("A");
  });
});

describe("Page.getByTestId", () => {
  it("keeps the default test-ID attribute", async () => {
    document.body.innerHTML = '<button data-testid="save">Save</button>';
    expect(await createPage().getByTestId("save").count()).toBe(1);
  });
});
