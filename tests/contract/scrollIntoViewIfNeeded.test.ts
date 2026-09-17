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

  // The pinned scroll fails with `error:notvisible` only for an element the
  // document does not lay out. A rendered box that cannot be seen is scrolled.
  it("scrolls elements without a visible box but waits out an unrendered one", async () => {
    document.body.innerHTML =
      '<div id=invisible style="visibility:hidden">invisible</div>' +
      '<div id=empty style="height:0">empty</div>' +
      '<div id=unrendered style="display:none">unrendered</div>';
    const page = createPage();

    await page.locator("#invisible").scrollIntoViewIfNeeded();
    await page.locator("#empty").scrollIntoViewIfNeeded();

    await expect(
      page.locator("#unrendered").scrollIntoViewIfNeeded({ timeout: 250 })
    ).rejects.toThrow(/scroll into view: Timeout 250ms exceeded/);
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
