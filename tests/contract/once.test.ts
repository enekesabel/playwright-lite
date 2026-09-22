import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { report } from "./pageEvents";

describe("Page.once", () => {
  it("fires one time and returns the page", () => {
    const page = createPage();
    const calls: string[] = [];
    expect(page.once("pageerror", () => calls.push("once"))).toBe(page);
    page.on("pageerror", () => calls.push("on"));
    report(new Error("1"));
    report(new Error("2"));
    expect(calls).toEqual(["once", "on", "on"]);
  });
});
