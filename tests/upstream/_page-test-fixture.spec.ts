import { expect, isKnownFailure, test } from "./pageTest";

test.describe("pageTest known corpus failures", () => {
  test("expects corpus tests outside the reviewed baseline to fail", () => {
    expect(
      isKnownFailure(["page-goto.spec.ts", "an unreviewed upstream test"])
    ).toBe(true);
    expect(
      isKnownFailure([
        "page-goto.spec.ts",
        "a describe block",
        "an unreviewed upstream test",
      ])
    ).toBe(true);
  });

  test("leaves tests outside the corpus unmarked", () => {
    expect(isKnownFailure(test.info().titlePath)).toBe(false);
    expect(test.info().expectedStatus).toBe("passed");
  });
});

let originalTestIdAttributeSetter: unknown;
let forcedAdapterSetupFailureObserved = false;

const testWithBrokenAdapterSetup = test.extend({
  context: async ({ context, playwright }, use) => {
    originalTestIdAttributeSetter ??= playwright.selectors.setTestIdAttribute;
    const originalNewPage = context.newPage.bind(context);
    (context as any).newPage = async () => {
      const page = await originalNewPage();
      (page as any).addInitScript = async () => {
        forcedAdapterSetupFailureObserved = true;
        throw new Error("forced adapter page setup failure");
      };
      return page;
    };
    try {
      await use(context);
    } finally {
      (context as any).newPage = originalNewPage;
    }
  },
});

test.describe.serial("page fixture setup cleanup", () => {
  testWithBrokenAdapterSetup.fail(
    "restores the test ID setter when adapter setup fails",
    async ({ page }) => {
      expect(page).toBeDefined();
    }
  );

  test("allows the restored test ID setter in a subsequent test", async ({
    playwright,
  }) => {
    expect(forcedAdapterSetupFailureObserved).toBe(true);
    expect(playwright.selectors.setTestIdAttribute).toBe(
      originalTestIdAttributeSetter
    );
    playwright.selectors.setTestIdAttribute("data-testid");
  });
});

test.describe("pageTest timeout configuration", () => {
  test.use({ actionTimeout: 15, navigationTimeout: 20 });

  test("applies resolved action timeout to the adapter page fixture", async ({
    page,
  }) => {
    const error = await page
      .locator("#missing")
      .click()
      .catch((error) => error);

    expect(error.message).toContain("Timeout 15ms exceeded");
  });

  test("keeps adapter page and per-call action timeouts ahead of fixture configuration", async ({
    page,
  }) => {
    await (page as any).setDefaultTimeout(80);
    const pageDefaultError = await page
      .locator("#missing")
      .click()
      .catch((error) => error);
    const explicitError = await page
      .locator("#missing")
      .click({ timeout: 40 })
      .catch((error) => error);

    expect(pageDefaultError.message).toContain("Timeout 80ms exceeded");
    expect(explicitError.message).toContain("Timeout 40ms exceeded");
  });

});

test.describe("pageTest abort signal transport", () => {
  test("aborts Page-level calls that carry a signal in the adapter", async ({
    page,
  }) => {
    const dispatched = new AbortController();
    setTimeout(() => dispatched.abort(new Error("stop dispatch")), 50);
    const dispatchError = await page
      .click("#missing", {
        signal: dispatched.signal,
        timeout: 0,
      } as any)
      .catch((error) => error);

    expect(dispatchError.name).toBe("AbortError");
    expect(dispatchError.message).toContain("page.click: stop dispatch");

    const waiting = new AbortController();
    setTimeout(() => waiting.abort(new Error("stop wait")), 50);
    const waitError = await page
      .waitForSelector("#missing", {
        signal: waiting.signal,
        timeout: 0,
      } as any)
      .catch((error) => error);

    expect(waitError.name).toBe("AbortError");
    expect(waitError.message).toContain("page.waitForSelector: stop wait");
  });

  test("restores the abort reason only for adapter aborts", async ({
    page,
  }) => {
    await page.setContent(`<button>click me</button>`);
    const controller = new AbortController();
    const reason = new Error("already aborted");
    controller.abort(reason);

    // Option validation runs before the adapter inspects the signal, so this
    // failure is not an abort even though the signal is already aborted.
    const validationError = await page
      .click("button", {
        signal: controller.signal,
        clickCount: 1.5,
      } as any)
      .catch((error) => error);

    expect(validationError.name).not.toBe("AbortError");
    expect(validationError.message).toContain("clickCount");
    expect(validationError.cause).toBeUndefined();

    const abortError = await page
      .click("button", { signal: controller.signal } as any)
      .catch((error) => error);

    expect(abortError.name).toBe("AbortError");
    expect(abortError.cause).toBe(reason);
  });
});

test.describe("pageTest explicit zero action timeout", () => {
  test.use({ actionTimeout: 0 });

  test("keeps an explicit zero timeout unbounded in the adapter fixture", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.setTimeout(() => {
        const button = document.createElement("button");
        button.id = "late";
        button.textContent = "Late";
        button.addEventListener("click", () => {
          button.dataset.clicked = "true";
        });
        document.body.append(button);
      }, 1_200);
    });

    await page.locator("#late").click();
    await expect(page.locator("#late")).toHaveAttribute("data-clicked", "true");
  });
});
