import { afterEach } from "vitest";

import { createPage } from "../../src/index";

/**
 * Helpers for the contract tests that observe the document's own `fetch`.
 */

/** Restores `window.fetch` to whatever the suite started with. */
export function restoreFetch() {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });
}

/**
 * Pages whose listeners are removed after each test. The `fetch` wrapper is
 * shared by every Page of this window, so a listener a test leaves behind
 * keeps the wrapper installed for the next one.
 */
export function networkPages() {
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

/** A same-origin URL that answers, used where only the URL matters. */
export const contractUrl = (path: string) => new URL(path, location.href).href;

/** A same-origin asset the test server answers with 200 and a known type. */
export const assetUrl = (query = "") =>
  new URL(`/tests/assets/title.html${query}`, location.origin).href;
