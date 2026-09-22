import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { assetUrl, sendXhr } from "./network";

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

  it("lists the document's fetch and XMLHttpRequest calls in one log", async () => {
    const page = createPage();
    await page.requests();

    await window.fetch(assetUrl("?mixed-fetch"));
    const { ended } = sendXhr(assetUrl("?mixed-xhr"));
    expect(await ended).toBe("load");

    const requests = await page.requests();
    expect(requests.map((request) => request.url())).toEqual([
      assetUrl("?mixed-fetch"),
      assetUrl("?mixed-xhr"),
    ]);
    expect(requests.map((request) => request.resourceType())).toEqual([
      "fetch",
      "xhr",
    ]);
  });
});
