import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { swallowWindowErrors } from "./pageEvents";

swallowWindowErrors();

const report = (error: unknown) =>
  window.dispatchEvent(new ErrorEvent("error", { error }));

const reject = (reason: unknown) =>
  window.dispatchEvent(
    new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason,
    })
  );

describe("Page.pageErrors", () => {
  it("collects errors raised before any pageerror listener ever subscribed", async () => {
    const page = createPage();
    report(new Error("before any listener"));

    await expect(page.pageErrors()).resolves.toEqual([
      expect.objectContaining({ message: "before any listener" }),
    ]);
  });

  it("returns errors from window error and unhandledrejection in order", async () => {
    const page = createPage();
    report(new Error("first"));
    reject(new Error("second"));
    report(new Error("third"));

    const errors = await page.pageErrors();
    expect(errors.map((e) => e.message)).toEqual(["first", "second", "third"]);
  });

  it("wraps a non-Error rejection reason like the pageerror event payload", async () => {
    const page = createPage();
    reject("Custom: detail");

    const [error] = await page.pageErrors();
    expect([error.name, error.message, error.stack]).toEqual([
      "Custom",
      "detail",
      "",
    ]);
  });

  it("returns a snapshot: mutating the result does not affect later reads", async () => {
    const page = createPage();
    report(new Error("kept"));

    const first = await page.pageErrors();
    first.push(new Error("not kept"));

    const second = await page.pageErrors();
    expect(second.map((e) => e.message)).toEqual(["kept"]);
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
    ).rejects.toThrow(
      "pageErrors: filter must be one of (all|since-navigation)"
    );
  });
});
