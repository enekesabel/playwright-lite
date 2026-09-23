/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to reach `window` properties the type does not know about */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.exposeBinding", () => {
  it("calls back with { page, frame: page } as source, and no context: this package has no BrowserContext", async () => {
    const page = createPage();
    let seenPage: unknown;
    let seenFrame: unknown;
    let sawContext = true;
    await page.exposeBinding("report", (source) => {
      seenPage = source.page;
      seenFrame = source.frame;
      sawContext = "context" in source;
    });

    await page.evaluate(() => (window as any).report());

    expect(seenPage).toBe(page);
    expect(seenFrame).toBe(page);
    expect(sawContext).toBe(false);
  });

  it("dispatches each of two pages on the same window through its own source and by-value round trip", async () => {
    const first = createPage();
    const second = createPage();
    let firstSeenPage: unknown;
    let secondSeenPage: unknown;

    await first.exposeBinding("fromFirst", (source) => {
      firstSeenPage = source.page;
    });
    await second.exposeBinding("fromSecond", (source) => {
      secondSeenPage = source.page;
    });

    await first.evaluate(() => {
      (window as any).fromFirst();
      (window as any).fromSecond();
    });

    expect(firstSeenPage).toBe(first);
    expect(secondSeenPage).toBe(second);
  });
});
