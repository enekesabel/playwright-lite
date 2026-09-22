import { afterEach } from "vitest";

import { createPage } from "../../src/index";

/**
 * Pages whose listeners are removed after each test. `window.alert`/
 * `confirm`/`prompt` are wrapped by whichever page subscribes first, shared
 * by every page of this window, so a listener a test leaves behind keeps the
 * wrapper installed for the next one.
 */
export function dialogPages() {
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

/** Restores `window.alert`/`confirm`/`prompt` to whatever the suite started with. */
export function restoreDialogs() {
  const alert = window.alert;
  const confirm = window.confirm;
  const prompt = window.prompt;
  afterEach(() => {
    window.alert = alert;
    window.confirm = confirm;
    window.prompt = prompt;
  });
}
