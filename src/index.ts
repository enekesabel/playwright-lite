import type { Page, PlaywrightTestOptions } from "@playwright/test";

import { PageImpl } from "./page";

export type CreatePageOptions = Partial<
  Pick<
    PlaywrightTestOptions,
    "testIdAttribute" | "actionTimeout" | "navigationTimeout"
  >
>;

/** Creates a Page for the current browser window. Omitted settings keep the runtime defaults. */
export function createPage(options: CreatePageOptions = {}): Page {
  if (
    options.testIdAttribute !== undefined &&
    (typeof options.testIdAttribute !== "string" ||
      !options.testIdAttribute.trim())
  ) {
    throw new TypeError("testIdAttribute must be a non-empty string.");
  }
  for (const name of ["actionTimeout", "navigationTimeout"] as const) {
    const value = options[name];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      throw new TypeError(`${name} must be a finite, non-negative number.`);
    }
  }
  const page = PageImpl.fromWindow(window, options.testIdAttribute);
  if (options.actionTimeout !== undefined)
    page.setDefaultTimeout(options.actionTimeout);
  if (options.navigationTimeout !== undefined)
    page.setDefaultNavigationTimeout(options.navigationTimeout);
  return page as unknown as Page;
}
