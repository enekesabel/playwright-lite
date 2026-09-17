import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.url", () => {
  it("returns the current document URL", () => {
    const page = createPage();
    expect(page.url()).toBe(window.location.href);
  });
});
