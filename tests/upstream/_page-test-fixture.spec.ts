import { expect, test } from "./pageTest";

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
