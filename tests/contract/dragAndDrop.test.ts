import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Page.dragAndDrop", () => {
  // Contract coverage: as for Locator.dragTo, under the Page's name; no
  // pinned drag test times out.
  it("names page.dragAndDrop when it times out, logging the source's steps before the target's", async () => {
    document.body.innerHTML =
      '<div id=src style="position: absolute; left: 10px; top: 10px; width: 80px; height: 80px"></div>';
    const page = createPage();

    const error: Error = await page
      .dragAndDrop("#src", "#missing", { timeout: 300 })
      .catch((error) => error);

    expect(error.message).toMatch(
      /^page\.dragAndDrop: Timeout 300ms exceeded\.[^]*\n {2}- waiting for locator\('#src'\)\n[^]*\n {4}- navigations have finished\n {2}- waiting for locator\('#missing'\)$/
    );
  });
});
