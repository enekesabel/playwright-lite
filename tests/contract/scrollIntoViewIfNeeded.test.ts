import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.scrollIntoViewIfNeeded", () => {
  it("scrolls a target below the fold into its scrollable ancestor", async () => {
    document.body.innerHTML = `<div id=scrollport style="height:100px;overflow:auto"><button id=button style="margin-top:1500px">Hover</button></div>`;
    const page = createPage();
    const scrollport = document.querySelector("#scrollport")!;

    await page.locator("#button").scrollIntoViewIfNeeded();

    expect(scrollport.scrollTop).toBeGreaterThan(0);
  });

  it("uses the native scrollIntoViewIfNeeded primitive when available", async () => {
    document.body.innerHTML = `<button id=button>Scroll</button>`;
    const page = createPage();
    const button = document.querySelector("#button") as HTMLButtonElement & {
      scrollIntoViewIfNeeded?: () => void;
    };
    const nativeScroll = vi.fn();
    button.scrollIntoViewIfNeeded = nativeScroll;
    button.scrollIntoView = vi.fn();

    await page.locator("#button").scrollIntoViewIfNeeded();

    expect(nativeScroll).toHaveBeenCalledOnce();
    expect(button.scrollIntoView).not.toHaveBeenCalled();
  });
});
