/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "./index";
import {
  isPlaywrightLiteLocator,
  LOCATOR_BRAND,
  resolveLocatorElements,
} from "./locator";

// kept pending a decision on whether locator identification and resolution
// become a supported interface

describe("locator brand", () => {
  it("isPlaywrightLiteLocator detects a real locator", () => {
    const page = createPage();
    const loc = page.locator("div");
    expect(isPlaywrightLiteLocator(loc)).toBe(true);
  });

  it("isPlaywrightLiteLocator rejects a plain object", () => {
    expect(isPlaywrightLiteLocator({ selector: "div" })).toBe(false);
  });

  it("isPlaywrightLiteLocator rejects null", () => {
    expect(isPlaywrightLiteLocator(null)).toBe(false);
  });

  it("isPlaywrightLiteLocator rejects a boolean brand (no structured payload)", () => {
    const fake = { [LOCATOR_BRAND]: true };
    expect(isPlaywrightLiteLocator(fake)).toBe(false);
  });

  it("brand payload exposes getSelector and resolveElements", () => {
    document.body.innerHTML = "<div>test</div>";
    const page = createPage();
    const loc = page.locator("div");
    const payload = (loc as any)[LOCATOR_BRAND];
    expect(typeof payload.getSelector).toBe("function");
    expect(typeof payload.resolveElements).toBe("function");
    expect(payload.resolveElements()).toHaveLength(1);
  });

  it("rejects a plain object in filter.has", () => {
    const page = createPage();
    const fakeLocator = { selector: "div" };
    expect(() =>
      page.locator("div").filter({ has: fakeLocator as any })
    ).toThrow(/expected an PlaywrightLite Locator/);
  });

  it("skips null/undefined in filter.has (falsy, matches Playwright truthy check)", () => {
    document.body.innerHTML = "<div>ok</div>";
    const page = createPage();
    const loc = page.locator("div").filter({ has: null as any });
    expect(loc).toBeDefined();
  });

  it("rejects a number in filter.hasNot with diagnostic type", () => {
    const page = createPage();
    expect(() => page.locator("div").filter({ hasNot: 42 as any })).toThrow(
      /expected an PlaywrightLite Locator.*got number/
    );
  });
});

describe("shared resolver", () => {
  it("resolveLocatorElements returns matching elements", () => {
    document.body.innerHTML = "<ul><li>A</li><li>B</li></ul>";
    const page = createPage();
    const loc = page.locator("li");
    const elements = resolveLocatorElements(loc);
    expect(elements).toHaveLength(2);
  });

  it("resolveLocatorElements throws for non-locator", () => {
    expect(() => resolveLocatorElements({})).toThrow(
      /expected an PlaywrightLite Locator/
    );
  });

  it("resolveLocatorElements throws for null", () => {
    expect(() => resolveLocatorElements(null)).toThrow(
      /expected an PlaywrightLite Locator.*got null/
    );
  });
});
