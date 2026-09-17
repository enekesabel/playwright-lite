import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.waitForTimeout", () => {
  it("waits for a plain timeout", async () => {
    const page = createPage();
    await expect(page.waitForTimeout(0)).resolves.toBeUndefined();
  });
});
