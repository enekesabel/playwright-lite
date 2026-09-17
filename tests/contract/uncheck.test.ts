import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.uncheck", () => {
  it("refuses to uncheck a radio button", async () => {
    document.body.innerHTML = `<input id=radio type=radio />`;
    const page = createPage();

    await page.locator("#radio").check();
    await expect(page.locator("#radio").uncheck()).rejects.toThrow(
      "Cannot uncheck radio button"
    );
  });

  it("runs trial unchecks without mutating", async () => {
    document.body.innerHTML = `<input id=checkbox type=checkbox checked />`;
    const page = createPage();
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;

    await page.locator("#checkbox").uncheck({ trial: true });

    expect(checkbox.checked).toBe(true);
  });

  it("reports the invoked checked method", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const error = await page
      .locator("button")
      .uncheck()
      .then(
        () => null,
        (error: Error) => error
      );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.startsWith("locator.uncheck:")).toBe(true);
    expect(error!.message).toContain("Not a checkbox");

    document.body.innerHTML = `<input type="checkbox" disabled checked>`;
    const timedOut = await page
      .locator("input")
      .uncheck({ timeout: 50 })
      .then(
        () => null,
        (error: Error) => error
      );
    expect(timedOut).toBeInstanceOf(Error);
    expect(timedOut!.message.startsWith("locator.uncheck:")).toBe(true);
    expect(timedOut!.message).toContain("Timeout 50ms exceeded");
  });
});

describe("Page.uncheck", () => {
  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=check type=checkbox checked />`;
    const page = createPage();

    await page.uncheck("#check");

    expect((document.querySelector("#check") as HTMLInputElement).checked).toBe(
      false
    );
  });

  it("reports the invoked checked method", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const error = await page.uncheck("button").then(
      () => null,
      (error: Error) => error
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.startsWith("page.uncheck:")).toBe(true);
    expect(error!.message).toContain("Not a checkbox");
  });
});
