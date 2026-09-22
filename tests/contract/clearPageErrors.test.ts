import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { swallowWindowErrors } from "./pageEvents";

swallowWindowErrors();

const report = (error: unknown) =>
  window.dispatchEvent(new ErrorEvent("error", { error }));

describe("Page.clearPageErrors", () => {
  it("empties the buffer pageErrors() reads", async () => {
    const page = createPage();
    report(new Error("one"));
    report(new Error("two"));
    await expect(page.pageErrors()).resolves.toHaveLength(2);

    await expect(page.clearPageErrors()).resolves.toBeUndefined();
    await expect(page.pageErrors()).resolves.toEqual([]);
  });

  it("does not stop collecting errors raised after clearing", async () => {
    const page = createPage();
    report(new Error("before"));
    await page.clearPageErrors();
    report(new Error("after"));

    const errors = await page.pageErrors();
    expect(errors.map((e) => e.message)).toEqual(["after"]);
  });
});
