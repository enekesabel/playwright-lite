import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.setChecked", () => {
  it("unchecks a checked control", async () => {
    document.body.innerHTML = `<input id=checkbox type=checkbox checked />`;
    const page = createPage();
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;

    await page.locator("#checkbox").setChecked(false);

    expect(checkbox.checked).toBe(false);
  });

  it("runs trial checks without mutating", async () => {
    document.body.innerHTML = `<input id=checkbox type=checkbox />`;
    const page = createPage();
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;

    await page.locator("#checkbox").setChecked(true, { trial: true });

    expect(checkbox.checked).toBe(false);
  });

  it("reports the invoked checked method", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const error = await page
      .locator("button")
      .setChecked(true)
      .then(
        () => null,
        (error: Error) => error
      );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.startsWith("locator.setChecked:")).toBe(true);
    expect(error!.message).toContain("Not a checkbox");

    document.body.innerHTML = `<input type="checkbox" disabled >`;
    const timedOut = await page
      .locator("input")
      .setChecked(true, { timeout: 50 })
      .then(
        () => null,
        (error: Error) => error
      );
    expect(timedOut).toBeInstanceOf(Error);
    expect(timedOut!.message.startsWith("locator.setChecked:")).toBe(true);
    expect(timedOut!.message).toContain("Timeout 50ms exceeded");
  });
});

describe("Page.setChecked", () => {
  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=check type=checkbox />`;
    const page = createPage();

    await page.setChecked("#check", true);

    expect((document.querySelector("#check") as HTMLInputElement).checked).toBe(
      true
    );
  });

  it("reports the invoked checked method", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const error = await page.setChecked("button", true).then(
      () => null,
      (error: Error) => error
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.startsWith("page.setChecked:")).toBe(true);
    expect(error!.message).toContain("Not a checkbox");
  });
});
