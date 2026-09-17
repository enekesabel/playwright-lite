import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.hover", () => {
  it("scrolls into view honoring modifiers and position", async () => {
    document.body.innerHTML =
      '<div style="height:120px;overflow:auto"><button style="margin-top:3000px">go</button></div>';
    const page = createPage();
    const container = document.querySelector("div")!;
    await page
      .locator("button")
      .hover({ modifiers: ["Shift"], position: { x: 4, y: 4 } });
    expect(container.scrollTop).toBeGreaterThan(0);
  });

  it("scrolls the target into view and emits hover events", async () => {
    document.body.innerHTML = `<div id=scrollport style="height:100px;overflow:auto"><button id=button style="margin-top:1500px">Hover</button></div>`;
    const page = createPage();
    const button = document.querySelector("#button") as HTMLButtonElement;
    const scrollport = document.querySelector("#scrollport")!;
    const events: string[] = [];
    button.addEventListener("pointerover", () => events.push("pointerover"));
    button.addEventListener("mouseover", () => events.push("mouseover"));

    await page.locator("#button").hover();

    expect(scrollport.scrollTop).toBeGreaterThan(0);
    expect(events).toEqual(["pointerover", "mouseover"]);
  });
});

describe("Page.hover", () => {
  it("delegates without re-entering a target the pointer already hovers", async () => {
    document.body.innerHTML = `
      <button id=button>Click</button>
      <input id=input />
    `;
    const page = createPage();
    const button = document.querySelector("#button")!;
    let hovers = 0;
    // Count adapter-dispatched events only: the browser fires its own
    // mouseover when the real cursor happens to rest over the new button.
    button.addEventListener("mouseover", (event) => {
      if (!event.isTrusted) hovers++;
    });

    await page.click("#button");
    await page.fill("#input", "a");
    await page.press("#input", "b");
    await page.type("#input", "cd");
    await page.focus("#input");
    await page.hover("#button");

    // Keyboard focus does not move the pointer or re-enter this button.
    expect(hovers).toBe(1);
  });
});
