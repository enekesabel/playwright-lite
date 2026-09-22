import type { Page, PlaywrightTestOptions } from "@playwright/test";

export { expect } from "./expect";
export type { Expect } from "./expect";
/**
 * The `Request` and `Response` objects the network events and waits report.
 * They are subsets of Playwright's, carrying only the members the current
 * document can fill; `createPage` still returns Playwright's own `Page` type,
 * so annotating with these is opt-in.
 */
export type { Request, Response } from "./network";
/**
 * The `Dialog` a `dialog` listener receives, a subset of Playwright's own.
 * `createPage` still returns Playwright's own `Page` type, so annotating with
 * this is optional; see [Dialog compatibility](#dialog-compatibility).
 */
export type { Dialog, DialogType } from "./dialog";

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
