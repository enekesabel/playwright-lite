import type { Locator, Page } from "@playwright/test";
import {
  ariaSnapshot,
  createPage,
  isPlaywrightLiteLocator,
  resolveLocatorElements,
  type CreatePageOptions,
} from "@enekesabel/playwright-lite";

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
  const profile = new ProfilePage(page);
  await profile.saveName("Ada");
  const resolved = resolveLocatorElements(profile.save);
  return {
    value: await profile.name.inputValue(),
    saved: output.textContent,
    clicks,
    trustedClick,
    branded: isPlaywrightLiteLocator(profile.save),
    resolvedButton: resolved?.[0] === button,
    defaultCount: await createPage().getByTestId("default").count(),
    snapshot: ariaSnapshot(document.body),
  };
}
