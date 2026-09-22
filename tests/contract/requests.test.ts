import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { assetUrl } from "./network";

describe("Page.requests", () => {
  it("returns nothing before the first call and the fetches made after it", async () => {
    const native = window.fetch;
    const page = createPage();

    await window.fetch(assetUrl("?before"));
    expect(await page.requests()).toEqual([]);
    expect(window.fetch).not.toBe(native);

    await window.fetch(assetUrl("?after"));
    expect((await page.requests()).map((request) => request.url())).toEqual([
      assetUrl("?after"),
    ]);
  });

  it("keeps the pinned bound on the recent requests", async () => {
    const page = createPage();
    await page.requests();

    for (let i = 0; i < 101; ++i) await window.fetch(assetUrl(`?n=${i}`));

    const urls = (await page.requests()).map((request) => request.url());
    // Pinned server/page.ts drops the oldest tenth once the log passes 100.
    expect(urls).toHaveLength(91);
    expect(urls[0]).toBe(assetUrl("?n=10"));
    expect(urls.at(-1)).toBe(assetUrl("?n=100"));
  });
});
