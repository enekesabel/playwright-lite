import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.filter", () => {
  it("preserves an empty filter without corrupting the selector", async () => {
    document.body.innerHTML = "<div><span>A</span></div>";
    const page = createPage();
    const base = page.locator("div");
    const filtered = base.filter({});
    expect(await filtered.count()).toBe(1);
  });

  it("serializes has with JSON.stringify quoting", async () => {
    document.body.innerHTML = `
      <div><span class="inner">match</span></div>
      <div><span class="other">no-match</span></div>
    `;
    const page = createPage();
    const inner = page.locator("span.inner");
    const filtered = page.locator("div").filter({ has: inner });
    expect(await filtered.count()).toBe(1);
  });

  it("serializes hasNot with JSON.stringify quoting", async () => {
    document.body.innerHTML = `
      <div><span class="exclude">excluded</span></div>
      <div><span class="keep">kept</span></div>
    `;
    const page = createPage();
    const exclude = page.locator("span.exclude");
    const filtered = page.locator("div").filter({ hasNot: exclude });
    expect(await filtered.count()).toBe(1);
  });

  it("supports visible filter option", async () => {
    document.body.innerHTML = `
      <div style="display:none">hidden</div>
      <div>visible</div>
    `;
    const page = createPage();
    const visible = page.locator("div").filter({ visible: true });
    expect(await visible.count()).toBe(1);
  });

  it("rejects a cross-page locator in has", () => {
    const page1 = createPage();
    const page2 = createPage();
    const loc2 = page2.locator("div");
    expect(() => page1.locator("div").filter({ has: loc2 })).toThrow(
      /same frame/
    );
  });

  it("rejects a cross-page locator in hasNot", () => {
    const page1 = createPage();
    const page2 = createPage();
    const loc2 = page2.locator("div");
    expect(() => page1.locator("div").filter({ hasNot: loc2 })).toThrow(
      /same frame/
    );
  });
});
