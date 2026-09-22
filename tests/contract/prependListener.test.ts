import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { report } from "./pageEvents";

describe("Page.prependListener", () => {
  it("runs before listeners added earlier and returns the page", () => {
    const page = createPage();
    const calls: string[] = [];
    page.on("pageerror", () => calls.push("on"));
    expect(
      page.prependListener("pageerror", () => calls.push("prepended"))
    ).toBe(page);
    report(new Error("1"));
    expect(calls).toEqual(["prepended", "on"]);
  });
});
