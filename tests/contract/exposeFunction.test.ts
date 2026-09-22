/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to reach `window` properties the type does not know about */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.exposeFunction", () => {
  it("keeps the exposed property callable after dispose(), because this package has no dispose lifecycle", async () => {
    const page = createPage();
    const disposable = await page.exposeFunction(
      "double",
      (n: number) => n * 2
    );
    await expect(page.evaluate(() => (window as any).double(21))).resolves.toBe(
      42
    );

    await disposable.dispose();

    // Pinned Playwright's `should dispose` test asserts the opposite: after
    // `dispose()`, calling the exposed function throws "is not a function".
    // This package invents no removal, so the property, and the call, still
    // work.
    await expect(page.evaluate(() => (window as any).double(10))).resolves.toBe(
      20
    );
  });

  it("[Symbol.asyncDispose]() on the returned Disposable is also a no-op", async () => {
    const page = createPage();
    const disposable = await page.exposeFunction(
      "triple",
      (n: number) => n * 3
    );
    await disposable[Symbol.asyncDispose]();
    await expect(page.evaluate(() => (window as any).triple(2))).resolves.toBe(
      6
    );
  });
});
