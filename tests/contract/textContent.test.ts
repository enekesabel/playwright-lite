import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.textContent", () => {
  it("returns attributes, text, and values through matching Page and Locator methods", async () => {
    document.body.innerHTML = `
      <div id=text name=value>Text content</div>
    `;
    const page = createPage();

    expect(await page.locator("#text").textContent()).toBe("Text content");
  });

  it("waits past one second when query timeout is omitted", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    window.setTimeout(
      () => (document.body.innerHTML = "<div id=late>Late</div>"),
      1_025
    );

    await expect(page.locator("#late").textContent()).resolves.toBe("Late");
  });
});

describe("Page.textContent", () => {
  it("returns attributes, text, and values through matching Page and Locator methods", async () => {
    document.body.innerHTML = `
      <div id=text name=value>Text content</div>
    `;
    const page = createPage();

    expect(await page.textContent("#text")).toBe("Text content");
  });
});
