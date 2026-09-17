/* eslint-disable @typescript-eslint/no-explicit-any -- intentional cast to test runtime option acceptance */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { PageImpl } from "../../src/page";

describe("Locator.locator", () => {
  it("Locator.locator accepts LocatorOptions (without visible)", async () => {
    document.body.innerHTML = `
      <ul>
        <li><span>A</span></li>
        <li><span>B</span></li>
      </ul>
    `;
    const page = createPage();
    const items = page.locator("li").locator("span", { hasText: "A" });
    expect(await items.count()).toBe(1);
  });

  it("accepts a locator as first argument", async () => {
    document.body.innerHTML = `
      <div>one <span>two</span> <button>three</button></div>
      <span>four</span>
      <button>five</button>
    `;
    const page = createPage();
    const inner = page.locator("button");
    const chained = page.locator("div").locator(inner);
    expect(await chained.count()).toBe(1);
  });

  it("rejects cross-page locator in Locator.locator()", () => {
    const page1 = createPage();
    const page2 = createPage();
    const loc2 = page2.locator("div");
    expect(() => page1.locator("div").locator(loc2)).toThrow(/same frame/);
  });
});

describe("Page.locator", () => {
  it("Page.locator accepts LocatorOptions including visible", async () => {
    document.body.innerHTML = `
      <div style="display:none">hidden</div>
      <div>visible</div>
    `;
    const page = createPage();
    // Playwright types don't expose visible on Page.locator options, but our
    // implementation accepts the full LocatorOptions shape
    const visible = (page as any).locator("div", { visible: true });
    expect(await visible.count()).toBe(1);
  });

  it("Page.locator accepts has/hasNot options", async () => {
    document.body.innerHTML = `
      <div><span>hello</span></div>
      <div><span>world</span></div>
    `;
    const page = createPage();
    const filtered = page.locator("div", { hasText: "hello" });
    expect(await filtered.count()).toBe(1);
  });

  it("lets :has-text match the HTML root", async () => {
    document.body.innerHTML = "<span>Find me</span>";
    const page = createPage() as unknown as PageImpl;

    expect(page.resolveAll(':has-text("find me")')[0]).toBe(
      document.documentElement
    );
    await expect(
      page.$eval(':has-text("find me")', (element) => element.tagName)
    ).resolves.toBe("HTML");
  });
});
