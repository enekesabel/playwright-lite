import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.$", () => {
  // Contract coverage: the upstream spec checks the pinned protocol text
  // without the API name.
  it("names itself when the selector is not a string", async () => {
    await expect(createPage().$(null as unknown as string)).rejects.toThrow(
      "page.$: selector: expected string, got object"
    );
  });
});
