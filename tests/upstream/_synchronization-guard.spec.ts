import { expect, test, type Page } from "@playwright/test";

import { installTestIdAttributeSynchronization } from "./adapter-bridge";

test("restores the test ID setter when initial synchronization fails", async ({
  page,
  playwright,
}) => {
  const originalSetter = playwright.selectors.setTestIdAttribute;
  const failingPage = {
    evaluate: async () => {
      throw new Error("forced initial test ID synchronization failure");
    },
  } as unknown as Page;

  await expect(
    installTestIdAttributeSynchronization(failingPage, playwright, "data-test")
  ).rejects.toThrow("forced initial test ID synchronization failure");
  expect(playwright.selectors.setTestIdAttribute).toBe(originalSetter);

  const reset = await installTestIdAttributeSynchronization(
    page,
    playwright,
    "data-test"
  );
  await reset();
  expect(playwright.selectors.setTestIdAttribute).toBe(originalSetter);
});
