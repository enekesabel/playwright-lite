import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.$eval", () => {
  // Contract coverage: the upstream no-match spec checks the pinned text
  // without the API name, and the spec that checks the name runs in a frame.
  it("names itself when no element matches", async () => {
    document.body.innerHTML = "<div></div>";

    await expect(
      createPage().$eval("section", (element) => element.id)
    ).rejects.toThrow(
      'page.$eval: Failed to find element matching selector "section"'
    );
  });
});
