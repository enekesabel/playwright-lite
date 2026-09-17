import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("Page.sessionStorage", () => {
  it("validates strings before touching native storage", async () => {
    const storage = createPage().sessionStorage;
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
