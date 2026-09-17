import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.pressSequentially", () => {
  it("types sequentially after clearing", async () => {
    document.body.innerHTML = `<input id=input value=before />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").clear();
    await page.locator("#input").pressSequentially("abc");

    expect(input.value).toBe("abc");
  });

  it("types literal spaces and arbitrary Unicode without relaxing press key validation", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").pressSequentially("hello world café 😀");

    expect(input.value).toBe("hello world café 😀");
    await expect(page.locator("#input").press("NotAKey")).rejects.toThrow(
      'Unknown key: "NotAKey"'
    );
  });

  it("uses one deadline for pressSequentially typing without a late character", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await expect(
      page
        .locator("#input")
        .pressSequentially("ab", { delay: 100, timeout: 20 })
    ).rejects.toThrow("Timeout 20ms exceeded");
    await page.waitForTimeout(120);

    expect(input.value).toBe("a");

    input.value = "";
    await page
      .locator("#input")
      .pressSequentially("ab", { delay: 5, timeout: 0 });
    expect(input.value).toBe("ab");
  });
});
