/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.check", () => {
  it("checks controls with Playwright's radio restriction", async () => {
    document.body.innerHTML = `
      <input id=checkbox type=checkbox />
      <input id=radio type=radio />
    `;
    const page = createPage();
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;

    await page.locator("#checkbox").check();
    expect(checkbox.checked).toBe(true);
    await page.locator("#radio").check();
  });

  it("does not click an already-correct control", async () => {
    document.body.innerHTML = `
      <input id=checkbox type=checkbox checked />
    `;
    const page = createPage();
    const checkbox = document.querySelector("#checkbox")!;
    let clicks = 0;
    checkbox.addEventListener("click", () => clicks++);

    await page.locator("#checkbox").check();
    expect(clicks).toBe(0);
  });

  it("validates trial and position options", async () => {
    document.body.innerHTML = `<input id=checkbox type=checkbox />`;
    const page = createPage();

    await expect(
      page.locator("#checkbox").check({ trial: "yes" } as any)
    ).rejects.toThrow("trial must be a boolean");
    await expect(
      page.locator("#checkbox").check({
        position: { x: Infinity, y: 0 },
      } as any)
    ).rejects.toThrow("position must have finite x and y numbers");
  });

  it("reports the invoked checked method", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const error = await page
      .locator("button")
      .check()
      .then(
        () => null,
        (error: Error) => error
      );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.startsWith("locator.check:")).toBe(true);
    expect(error!.message).toContain("Not a checkbox");

    document.body.innerHTML = `<input type="checkbox" disabled >`;
    const timedOut = await page
      .locator("input")
      .check({ timeout: 50 })
      .then(
        () => null,
        (error: Error) => error
      );
    expect(timedOut).toBeInstanceOf(Error);
    expect(timedOut!.message.startsWith("locator.check:")).toBe(true);
    expect(timedOut!.message).toContain("Timeout 50ms exceeded");
  });
});

describe("Page.check", () => {
  it("checks labels at a requested position and runs trial checks without mutating", async () => {
    document.body.innerHTML = `
      <label for=checkbox style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px"><span id=hit style="display:block; position:absolute; inset:0">Click me</span></label>
      <input id=checkbox type=checkbox />
    `;
    const page = createPage();
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;
    const label = document.querySelector("label")!;
    const hit = document.querySelector("#hit")!;
    const points: Array<{ x: number; y: number }> = [];
    const targets: string[] = [];
    label.addEventListener("pointerdown", (event) =>
      points.push({ x: event.clientX, y: event.clientY })
    );
    label.addEventListener("pointerdown", (event) =>
      targets.push((event.target as Element).id)
    );

    await page.check("#checkbox", { trial: true });
    expect(checkbox.checked).toBe(false);

    await page.check("label", { position: { x: 7, y: 9 } });
    expect(checkbox.checked).toBe(true);
    expect(points).toEqual([{ x: 17, y: 29 }]);
    expect(targets).toEqual([hit.id]);
  });

  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=check type=checkbox />`;
    const page = createPage();

    await page.check("#check");

    expect((document.querySelector("#check") as HTMLInputElement).checked).toBe(
      true
    );
  });

  it("reports the invoked checked method", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const error = await page.check("button").then(
      () => null,
      (error: Error) => error
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.startsWith("page.check:")).toBe(true);
    expect(error!.message).toContain("Not a checkbox");
  });
});
