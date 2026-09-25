import type { Page, PlaywrightTestOptions } from "@playwright/test";

export { expect } from "./expect";
export type { Expect } from "./expect";
/** Playwright's `selectors`, for registering custom selector engines. */
export { selectors } from "./selectors";
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
 * this is optional.
 */
export type { Dialog } from "./dialog";
/** Playwright's `FileChooser`, which a `filechooser` listener receives, re-exported for optional annotation; `createPage` still returns Playwright's own `Page` type unchanged. */
export type { FileChooser } from "@playwright/test";
/** Playwright's `ConsoleMessage`, re-exported for optional annotation; `createPage` still returns Playwright's own `Page` type unchanged. */
export type { ConsoleMessage } from "./console";

import { PageImpl } from "./page";
import { TypeError, resolvePageGlobals } from "virtual:playwright-lite-globals";

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
  // Pinned Playwright settles its page globals when it sets up the scripts
  // for a document; this is that point here. It applies to every page.
  resolvePageGlobals();
  const page = PageImpl.fromWindow(window, options.testIdAttribute);
  if (options.actionTimeout !== undefined)
    page.setDefaultTimeout(options.actionTimeout);
  if (options.navigationTimeout !== undefined)
    page.setDefaultNavigationTimeout(options.navigationTimeout);
  return page as unknown as Page;
}
