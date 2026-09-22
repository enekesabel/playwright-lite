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

  it("keeps the exposed property callable after dispose(), and never touches a property the Site replaced", async () => {
    const page = createPage();
    const disposable = await page.exposeBinding("hook", () => "original");
    await disposable.dispose();

    // Site replaces the binding after us; dispose() must not have removed,
    // and must never remove, the Site's own replacement.
    await page.evaluate(() => {
      (window as any).hook = () => "replaced-by-site";
    });
    await expect(page.evaluate(() => (window as any).hook())).resolves.toBe(
      "replaced-by-site"
    );
  });
});
