import { afterEach } from "vitest";

import { createPage } from "../../src/index";

/**
 * Helpers for the contract tests that observe the document's own `console`.
 */

/**
 * Pages whose listeners are removed after each test. The `console` wrapper
 * is shared by every Page of this window, so a listener a test leaves behind
 * keeps the wrapper installed for the next one.
 */
export function consolePages() {
  const pages: ReturnType<typeof createPage>[] = [];
  afterEach(() => {
    for (const page of pages.splice(0)) page.removeAllListeners();
  });
  return () => {
    const page = createPage();
    pages.push(page);
    return page;
  };
}

/**
 * Restores every `console.*` method to what the suite started with.
 * `consoleMessages()` retains its subscription like `requests()` does, so a
 * test that calls it leaves the wrapper installed for the next one; tests
 * that inspect the wrapped/unwrapped method identity need this reset.
 */
export function restoreConsole() {
  const originals = new Map<string, unknown>();
  for (const key in console)
    originals.set(key, (console as unknown as Record<string, unknown>)[key]);
  afterEach(() => {
    for (const [key, value] of originals)
      (console as unknown as Record<string, unknown>)[key] = value;
  });
}
