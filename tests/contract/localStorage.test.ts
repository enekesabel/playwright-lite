import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("Page.localStorage", () => {
  it("keeps storage independent without imposing key order", async () => {
    const page = createPage();
    expect(await page.localStorage.getItem("missing")).toBeNull();
    await page.localStorage.setItem("first", "one");
    await page.localStorage.setItem("second", "two");
    await page.localStorage.setItem("first", "updated");
    await page.sessionStorage.setItem("first", "session");
    expect(new Set(await page.localStorage.items())).toEqual(
      new Set([
        { name: "first", value: "updated" },
        { name: "second", value: "two" },
      ])
    );
    await page.localStorage.removeItem("first");
    expect(await page.localStorage.items()).toEqual([
      { name: "second", value: "two" },
    ]);
    await page.localStorage.clear();
    expect(await page.localStorage.items()).toEqual([]);
    expect(await page.sessionStorage.getItem("first")).toBe("session");
  });

  it("validates strings before touching native storage", async () => {
    const storage = createPage().localStorage;
    await storage.setItem("key", "original");
    for (const value of [undefined, null, 123, true, {}, []]) {
      for (const operation of [
        () => storage.getItem(value as never),
        () => storage.removeItem(value as never),
        () => storage.setItem(value as never, "value"),
        () => storage.setItem("key", value as never),
      ])
        await expect(operation()).rejects.toThrow("expected string");
    }
    expect(await storage.items()).toEqual([{ name: "key", value: "original" }]);
    await storage.setItem(Object("boxed"), Object("accepted"));
    expect(await storage.getItem(Object("boxed"))).toBe("accepted");
    await storage.removeItem(Object("boxed"));
    expect(await storage.getItem("boxed")).toBeNull();
  });
});
