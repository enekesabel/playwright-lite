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

  it.each(["requests() first", "listeners first"])(
    "shares one subscription with the network listeners, %s",
    async (order) => {
      const page = createPage();
      const slug = order.replace(/\W+/g, "-");
      const listened = assetUrl(`?listened${slug}`);
      const unlistened = assetUrl(`?unlistened${slug}`);
      // A listener sees every request of the window, including the tail of an
      // earlier test's fetch, so only this test's two URLs are recorded.
      const seen: string[] = [];
      const record = (event: string) => (target: { url(): string }) => {
        if ([listened, unlistened].includes(target.url())) seen.push(event);
      };
      const onRequest = record("request");
      const onResponse = record("response");
      const onRequestFinished = record("requestfinished");
      const listen = () => {
        page.on("request", onRequest);
        page.on("response", onResponse);
        page.on("requestfinished", onRequestFinished);
      };
      if (order === "requests() first") {
        await page.requests();
        listen();
      } else {
        listen();
        await page.requests();
      }

      const finished = page.waitForEvent(
        "requestfinished",
        (request) => request.url() === listened
      );
      await (await window.fetch(listened)).text();
      await finished;
      expect(seen).toEqual(["request", "response", "requestfinished"]);
      expect((await page.requests()).map((request) => request.url())).toEqual([
        listened,
      ]);

      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onRequestFinished);
      await (await window.fetch(unlistened)).text();
      expect(seen).toEqual(["request", "response", "requestfinished"]);
      expect((await page.requests()).map((request) => request.url())).toEqual([
        listened,
        unlistened,
      ]);
    }
  );

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
