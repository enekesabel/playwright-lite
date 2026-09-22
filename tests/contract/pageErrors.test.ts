import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { report, swallowWindowErrors } from "./pageEvents";

swallowWindowErrors();

describe("Page.pageErrors", () => {
  it("returns a snapshot: mutating the result does not affect later reads", async () => {
    const page = createPage();
    report(new Error("kept"));

    const first = await page.pageErrors();
    first.push(new Error("not kept"));

    const second = await page.pageErrors();
    expect(second.map((e) => e.message)).toEqual(["kept"]);
  });

  it("bounds the buffer to the pinned limit, dropping the oldest tenth", async () => {
    const page = createPage();
    for (let i = 1; i <= 301; i++) report(new Error(`error${i}`));

    const errors = await page.pageErrors();
    expect(errors).toHaveLength(181);
    expect(errors[errors.length - 1].message).toBe("error301");
  });

  it("keeps delivering to pageerror listeners the same as before", async () => {
    const page = createPage();
    report(new Error("pre-subscription"));

    const seen: string[] = [];
    page.on("pageerror", (error) => seen.push(error.message));
    report(new Error("post-subscription"));

    expect(seen).toEqual(["post-subscription"]);
    await expect(page.pageErrors()).resolves.toEqual([
      expect.objectContaining({ message: "pre-subscription" }),
      expect.objectContaining({ message: "post-subscription" }),
    ]);
  });

  it('`filter: "all"` and the default `since-navigation` return the same errors', async () => {
    const page = createPage();
    report(new Error("one"));
    report(new Error("two"));

    const [all, sinceNavigation, defaulted] = await Promise.all([
      page.pageErrors({ filter: "all" }),
      page.pageErrors({ filter: "since-navigation" }),
      page.pageErrors(),
    ]);
    const messages = (errors: Error[]) => errors.map((e) => e.message);
    expect(messages(all)).toEqual(["one", "two"]);
    expect(messages(sinceNavigation)).toEqual(messages(all));
    expect(messages(defaulted)).toEqual(messages(all));
  });

  it("rejects an unsupported filter value", async () => {
    const page = createPage();
    await expect(
      page.pageErrors({ filter: "unknown" as "all" })
    ).rejects.toThrow("filter: expected one of (all|since-navigation)");
  });
});
