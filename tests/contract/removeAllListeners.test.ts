import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";

// The vitest runner reports a window error as an unhandled test error only
// while no other `error` listener is registered. These tests dispatch errors
// after the page has unsubscribed, so keep one registered meanwhile.
const swallow = () => {};
beforeEach(() => window.addEventListener("error", swallow));
afterEach(() => {
  window.removeEventListener("error", swallow);
  vi.restoreAllMocks();
});

const report = (error: unknown) =>
  window.dispatchEvent(new ErrorEvent("error", { error }));

describe("Page.removeAllListeners", () => {
  it("drops the listeners of one event and stops listening to the window", () => {
    const removed = vi.spyOn(window, "removeEventListener");
    const page = createPage();
    const listener = vi.fn();
    page.on("pageerror", listener).on("pageerror", vi.fn());

    expect(page.removeAllListeners("pageerror")).toBe(page);
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual([
      "error",
      "unhandledrejection",
    ]);
    report(new Error("after"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops every event without a type and resolves with options", async () => {
    const page = createPage();
    const listener = vi.fn();
    page.on("pageerror", listener).on("load", listener);

    expect(page.removeAllListeners()).toBe(page);
    report(new Error("after"));
    expect(listener).not.toHaveBeenCalled();
    await expect(
      page.removeAllListeners("pageerror", { behavior: "wait" })
    ).resolves.toBeUndefined();
  });
});
