import type { Locator, Page } from "@playwright/test";
import {
  createPage,
  expect,
  type CreatePageOptions,
  type Expect,
} from "@enekesabel/playwright-lite";
import * as publicExports from "@enekesabel/playwright-lite";

class ProfilePage {
  readonly name: Locator;
  readonly save: Locator;

  constructor(private readonly page: Page) {
    this.name = page.getByTestId("name");
    this.save = page.getByRole("button", { name: "Save", exact: true });
  }

  async saveName(value: string) {
    await this.name.fill(value);
    await this.name.focus();
    await this.page.keyboard.type("!");
    await this.save.click();
  }
}

export async function runConsumer() {
  const input = document.querySelector<HTMLInputElement>("input")!;
  const button = document.querySelector<HTMLButtonElement>("button")!;
  const output = document.querySelector<HTMLOutputElement>("output")!;
  let clicks = 0;
  let trustedClick: boolean | undefined;
  button.addEventListener("click", (event) => {
    clicks++;
    trustedClick = event.isTrusted;
    output.textContent = input.value;
  });
  const options: CreatePageOptions = {
    testIdAttribute: "data-test",
    actionTimeout: 1_000,
    navigationTimeout: 30_000,
  };
  const page: Page = createPage(options);
  const configuredExpect: Expect = expect.configure({ timeout: 100 });
  const receiverExpect = expect.extend({
    toHaveAmount(locator: Locator, expected: string) {
      const isNot: boolean = this.isNot;
      return {
        pass: Boolean(locator) && expected.length > 0 && !isNot,
        message: () => "amount differs",
      };
    },
    toBeANicePage(page: Page) {
      return { pass: Boolean(page), message: () => "page is not nice" };
    },
  });
  if (false) {
    receiverExpect(page.getByTestId("name")).toHaveAmount("3");
    receiverExpect(page).toBeANicePage();
    // @ts-expect-error Locator-only custom matcher.
    receiverExpect(page).toHaveAmount("3");
    // @ts-expect-error Page-only custom matcher.
    receiverExpect(page.getByTestId("name")).toBeANicePage();
  }
  configuredExpect({ user: "Ada" }).toEqual({
    user: expect.stringContaining("Ada"),
  });
  let observed = 0;
  await configuredExpect.poll(() => ++observed, { intervals: [0] }).toBe(2);
  const profile = new ProfilePage(page);
  await profile.saveName("Ada");
  return {
    exports: Object.keys(publicExports).sort(),
    value: await profile.name.inputValue(),
    saved: output.textContent,
    clicks,
    trustedClick,
    defaultCount: await createPage().getByTestId("default").count(),
    snapshot: await page.ariaSnapshot(),
    locatorSnapshot: await profile.save.ariaSnapshot(),
    expectObserved: observed,
  };
}
