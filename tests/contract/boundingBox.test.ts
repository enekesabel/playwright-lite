/* eslint-disable @typescript-eslint/no-explicit-any -- intentional cast to stub getClientRects */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.boundingBox", () => {
  it("reads checked state and geometry through a fixed ElementHandle", async () => {
    document.body.innerHTML = `
      <input id=checkbox type=checkbox checked
        style="appearance: none; border: 0; margin: 0; padding: 0; position: fixed; left: 10px; top: 20px; width: 100px; height: 40px" />
    `;
    const page = createPage();
    const handle = await page.$("#checkbox");

    expect(handle).not.toBeNull();
    expect(await handle!.boundingBox()).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    });
  });

  it("returns no box for fixed handles that are detached or not rendered", async () => {
    document.body.innerHTML = `
      <div style="display: none"><span id=hidden>hidden</span></div>
      <span id=detached>detached</span>
    `;
    const page = createPage();
    const hidden = await page.$("#hidden");
    const detached = await page.$("#detached");

    expect(hidden).not.toBeNull();
    expect(detached).not.toBeNull();
    expect(await hidden!.boundingBox()).toBeNull();
    document.querySelector("#detached")!.remove();
    expect(await detached!.boundingBox()).toBeNull();
  });

  it("returns a visible element's browser bounds and null when hidden", async () => {
    document.body.innerHTML = `<div id=visible></div><div id=hidden hidden></div>`;
    const visible = document.querySelector("#visible")!;
    visible.getBoundingClientRect = () =>
      ({ x: 10, y: 20, width: 30, height: 40 }) as DOMRect;
    const page = createPage();

    expect(await page.locator("#visible").boundingBox()).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(await page.locator("#hidden").boundingBox()).toBeNull();
  });

  it("preserves a rendered zero-size bounding box", async () => {
    document.body.innerHTML = `<div id=zero></div>`;
    const zero = document.querySelector("#zero")!;
    zero.getBoundingClientRect = () =>
      ({ x: 0, y: 2020, width: 1280, height: 0 }) as DOMRect;
    zero.getClientRects = () => [zero.getBoundingClientRect()] as any;
    const page = createPage();

    await expect(page.locator("#zero").boundingBox()).resolves.toEqual({
      x: 0,
      y: 2020,
      width: 1280,
      height: 0,
    });
  });
});
