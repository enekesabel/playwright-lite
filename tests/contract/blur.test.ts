import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.blur", () => {
  it("blurs the focused target element and fires a blur event", async () => {
    document.body.innerHTML = `<input id=input value=before />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("blur", () => events.push("blur"));

    await page.locator("#input").focus();
    await page.locator("#input").blur();

    expect(document.activeElement).not.toBe(input);
    expect(events).toEqual(["blur"]);
  });
});
