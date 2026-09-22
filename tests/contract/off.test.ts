import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";

// The vitest runner reports a window error as an unhandled test error only
// while no other `error` listener is registered. This test dispatches an error
// after the page has unsubscribed, so keep one registered meanwhile.
const swallow = () => {};
beforeEach(() => window.addEventListener("error", swallow));
afterEach(() => {
  window.removeEventListener("error", swallow);
  vi.restoreAllMocks();
});

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
