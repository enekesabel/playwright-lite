import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.title", () => {
  it("delegates title queries to the controlled document", async () => {
    document.title = "Adapter title";
    const page = createPage();

    await expect(page.title()).resolves.toBe("Adapter title");
  });
});
