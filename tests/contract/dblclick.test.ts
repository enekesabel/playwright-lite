/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.dblclick", () => {
  it("dispatches dblclick only for the primary button", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const events: number[] = [];
    const button = document.querySelector("button")!;
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("dblclick", (event) => events.push(event.button));
    await page.dblclick("button", { button: "right" });
    await page.locator("button").dblclick({ button: "middle" });
    await (await page.$("button"))!.dblclick();
    expect(events).toEqual([0]);
  });

  it("doubly clicks through the shared action path with native activation", async () => {
    document.body.innerHTML = `
      <button id=button style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px">go</button>
      <input id=checkbox type=checkbox />
    `;
    const page = createPage();
    const button = document.querySelector("#button")!;
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;
    const events: Array<{ type: string; detail: number }> = [];
    let activations = 0;
    let changes = 0;
    for (const type of ["mousedown", "mouseup", "click", "dblclick"])
      button.addEventListener(type, (event) => {
        events.push({ type, detail: (event as MouseEvent).detail });
      });
    button.addEventListener("click", () => activations++);
    checkbox.addEventListener("change", () => changes++);

    await page.locator("#button").dblclick();
    expect(events.map((event) => event.type)).toEqual([
      "mousedown",
      "mouseup",
      "click",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
    ]);
    expect(events.filter((event) => event.type === "mousedown")).toEqual([
      { type: "mousedown", detail: 1 },
      { type: "mousedown", detail: 2 },
    ]);
    expect(events.filter((event) => event.type === "click")).toEqual([
      { type: "click", detail: 1 },
      { type: "click", detail: 2 },
    ]);
    expect(events.at(-1)).toEqual({ type: "dblclick", detail: 2 });
    expect(activations).toBe(2);

    await page.locator("#checkbox").dblclick();
    expect(checkbox.checked).toBe(false);
    expect(changes).toBe(2);

    await expect(
      page.locator("#button").dblclick({ signal: true } as any)
    ).rejects.toThrow("dblclick signal must be an AbortSignal");
    await expect(
      page.locator("#button").dblclick({ trial: "yes" } as any)
    ).rejects.toThrow("trial must be a boolean");
    await expect(
      page.locator("#button").dblclick({
        position: { x: Infinity, y: 0 },
      } as any)
    ).rejects.toThrow("position must have finite x and y numbers");
    expect(activations).toBe(2);
  });

  // Pinned input.ts Mouse.click forwards `steps` to Mouse.move for dblclick
  // exactly as it does for click.
  it("emits interpolated mousemove positions for steps", async () => {
    document.body.innerHTML = `
      <div id="target" style="position:fixed; left:150px; top:280px; width:100px; height:40px">Click me</div>
    `;
    const page = createPage();
    const moves: [number, number][] = [];
    const record = (event: MouseEvent) =>
      moves.push([event.clientX, event.clientY]);
    document.addEventListener("mousemove", record);

    try {
      await page.locator("#target").dblclick({ steps: 2 });
    } finally {
      document.removeEventListener("mousemove", record);
    }

    expect(moves).toEqual([
      [100, 150],
      [200, 300],
    ]);
  });
});
