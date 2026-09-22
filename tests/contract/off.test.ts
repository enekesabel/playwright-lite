import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import { swallowWindowErrors } from "./pageEvents";
import { contractUrl, restoreFetch } from "./network";

swallowWindowErrors();

const report = (error: unknown) =>
  window.dispatchEvent(new ErrorEvent("error", { error }));

describe("Page.off", () => {
  it("stops listening to the window with the last pageerror listener", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const types = (spy: typeof added) =>
      spy.mock.calls.map(([type]) => type).sort();
    const page = createPage();
    const first = vi.fn();
    const second = vi.fn();

    page.on("load", () => {});
    expect(added).not.toHaveBeenCalled();

    page.on("pageerror", first).on("pageerror", second);
    expect(types(added)).toEqual(["error", "unhandledrejection"]);
    page.off("pageerror", first);
    expect(removed).not.toHaveBeenCalled();
    page.off("pageerror", second);
    expect(types(removed)).toEqual(["error", "unhandledrejection"]);

    report(new Error("after"));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});

describe("Page.off network events", () => {
  restoreFetch();

  it("restores window.fetch with the last network listener", () => {
    const native = window.fetch;
    const page = createPage();
    const first = () => {};
    const second = () => {};

    page.on("request", first);
    expect(window.fetch).not.toBe(native);
    page.on("response", second);
    page.off("request", first);
    expect(window.fetch).not.toBe(native);
    page.off("response", second);
    expect(window.fetch).toBe(native);
  });

  it("leaves a wrapper the document installed after ours in place", async () => {
    const page = createPage();
    const listener = () => {};
    page.on("request", listener);

    const ours = window.fetch;
    const calls: unknown[] = [];
    const theirs = ((...args: Parameters<typeof fetch>) => {
      calls.push(args[0]);
      return ours(...args);
    }) as typeof fetch;
    window.fetch = theirs;

    page.off("request", listener);

    expect(window.fetch).toBe(theirs);
    await expect(window.fetch(contractUrl("."))).resolves.toBeInstanceOf(
      Response
    );
    expect(calls).toHaveLength(1);
  });
});
