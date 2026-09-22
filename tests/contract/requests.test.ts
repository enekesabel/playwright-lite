import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { contractUrl, recordedFetch, restoreFetch } from "./network";

describe("Page.requests", () => {
  restoreFetch();

  it("returns nothing before the first call and the fetches made after it", async () => {
    const native = window.fetch;
    const page = createPage();

    void window.fetch(contractUrl("./before"));
    expect(await page.requests()).toEqual([]);
    expect(window.fetch).not.toBe(native);

    void window.fetch(contractUrl("./after"));
    expect((await page.requests()).map((request) => request.url())).toEqual([
      contractUrl("./after"),
    ]);
  });

  it("keeps the pinned bound on the recent requests", async () => {
    recordedFetch();
    const page = createPage();
    await page.requests();

    for (let i = 0; i < 101; ++i) await window.fetch(contractUrl(`./n${i}`));

    const urls = (await page.requests()).map((request) => request.url());
    // Pinned server/page.ts drops the oldest tenth once the log passes 100.
    expect(urls).toHaveLength(91);
    expect(urls[0]).toBe(contractUrl("./n10"));
    expect(urls.at(-1)).toBe(contractUrl("./n100"));
  });
});
