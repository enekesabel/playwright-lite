import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.type", () => {
  it("does not type later characters after timeout", async () => {
    document.body.innerHTML = '<input id="input" />';
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;
    page.setDefaultTimeout(20);

    await expect(page.type("#input", "ab", { delay: 100 })).rejects.toThrow(
      "Timeout 20ms exceeded"
    );
    await page.waitForTimeout(120);

    expect(input.value).toBe("a");
  });

  it("types text through a strict locator with delay and an explicit zero timeout", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").type("abc", { delay: 5, timeout: 0 });

    expect(input.value).toBe("abc");
  });

  it("keeps Locator.type strict", async () => {
    document.body.innerHTML = `<input /><input />`;
    const page = createPage();

    await expect(page.locator("input").type("x")).rejects.toThrow(
      /strict mode violation/
    );
  });
});
