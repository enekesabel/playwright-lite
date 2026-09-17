/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.dispatchEvent", () => {
  it("dispatches an initialized event that bubbles and can be canceled", async () => {
    document.body.innerHTML =
      "<div id=parent><button id=button>go</button></div>";
    const page = createPage();
    const button = document.querySelector("#button")!;
    const parent = document.querySelector("#parent")!;
    const events: Array<{
      target: string;
      detail: number;
      clientX: number;
    }> = [];
    button.addEventListener("click", (event) => {
      const mouse = event as MouseEvent;
      events.push({
        target: "button",
        detail: mouse.detail,
        clientX: mouse.clientX,
      });
      event.preventDefault();
    });
    parent.addEventListener("click", (event) => {
      const mouse = event as MouseEvent;
      events.push({
        target: "parent",
        detail: mouse.detail,
        clientX: mouse.clientX,
      });
      expect(event.defaultPrevented).toBe(true);
    });

    await page.locator("#button").dispatchEvent("click", {
      clientX: 7,
      detail: 3,
    });

    expect(events).toEqual([
      { target: "button", detail: 3, clientX: 7 },
      { target: "parent", detail: 3, clientX: 7 },
    ]);
  });

  it("rejects unsupported options", async () => {
    document.body.innerHTML = "<button id=button>go</button>";
    const page = createPage();
    let clicks = 0;
    document
      .querySelector("#button")!
      .addEventListener("click", () => clicks++);

    await expect(
      page.locator("#button").dispatchEvent("click", {}, { force: true } as any)
    ).rejects.toThrow("unsupported Playwright option(s): force");
    expect(clicks).toBe(0);
  });
});

describe("Page.dispatchEvent", () => {
  it("dispatches to the first match by default and enforces strict mode when requested", async () => {
    document.body.innerHTML =
      "<button class=item>first</button><button class=item>second</button>";
    const page = createPage();
    const dispatched: string[] = [];
    document
      .querySelector(".item")!
      .addEventListener("click", () => dispatched.push("first"));

    await page.dispatchEvent(".item", "click");
    expect(dispatched).toEqual(["first"]);

    await expect(
      page.dispatchEvent(".item", "click", {}, { strict: true })
    ).rejects.toThrow("strict mode violation");
    expect(dispatched).toEqual(["first"]);
  });
});
