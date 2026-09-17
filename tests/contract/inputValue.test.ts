import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.inputValue", () => {
  it("returns attributes, text, and values through matching Page and Locator methods", async () => {
    document.body.innerHTML = `
      <label id=label for=input>Input label</label>
      <input id=input value=value />
      <textarea id=textarea>Text area</textarea>
    `;
    const page = createPage();

    expect(await page.locator("#input").inputValue()).toBe("value");
    expect(await page.locator("#textarea").inputValue()).toBe("Text area");
    expect(await page.locator("#label").inputValue()).toBe("value");
  });

  it("rejects invalid input-value and checked targets without retrying", async () => {
    document.body.innerHTML = "<div></div><input type=text />";
    const page = createPage();

    await expect(page.locator("div").inputValue()).rejects.toThrow(
      "Node is not an <input>, <textarea> or <select> element"
    );
  });
});

describe("Page.inputValue", () => {
  it("returns attributes, text, and values through matching Page and Locator methods", async () => {
    document.body.innerHTML = `
      <select id=select><option value=one>One</option><option value=two selected>Two</option></select>
    `;
    const page = createPage();

    expect(await page.inputValue("#select")).toBe("two");
  });

  it("honors an explicit query timeout for a missing target", async () => {
    document.body.innerHTML = "";
    const page = createPage();

    await expect(page.inputValue("#never", { timeout: 25 })).rejects.toThrow(
      /Timeout 25ms exceeded/
    );
  });
});
