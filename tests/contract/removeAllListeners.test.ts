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
      page.removeAllListeners("pageerror", { behavior: "default" })
    ).resolves.toBeUndefined();
  });

  const settleAfter = (ms: number, error?: Error) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => (error ? reject(error) : resolve()), ms)
    );
  const loggedErrors = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map(([value]) => value)
      .filter((value) => !(value instanceof Event));

  it("waits for a pending async listener with behavior wait", async () => {
    const page = createPage();
    let finished = false;
    page.on("pageerror", () => settleAfter(20).then(() => (finished = true)));
    report(new Error("slow"));
    expect(finished).toBe(false);

    await expect(
      page.removeAllListeners("pageerror", { behavior: "wait" })
    ).resolves.toBeUndefined();
    expect(finished).toBe(true);
  });

  it("rejects with the pending listener's error with behavior wait", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = createPage();
    page.on("pageerror", () => settleAfter(10, new Error("slow failure")));
    report(new Error("slow"));

    await expect(
      page.removeAllListeners(undefined, { behavior: "wait" })
    ).rejects.toThrow("slow failure");
    expect(loggedErrors(logged)).toEqual([]);
  });

  it("swallows a later failure of a pending listener with behavior ignoreErrors", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = createPage();
    page.on("pageerror", () => settleAfter(10, new Error("ignored")));
    report(new Error("slow"));

    await expect(
      page.removeAllListeners("pageerror", { behavior: "ignoreErrors" })
    ).resolves.toBeUndefined();
    await settleAfter(30);
    expect(loggedErrors(logged)).toEqual([]);
  });

  it("logs a later failure of a pending listener without a behavior", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = createPage();
    page.on("pageerror", () => settleAfter(10, new Error("logged")));
    report(new Error("slow"));

    expect(page.removeAllListeners("pageerror")).toBe(page);
    await settleAfter(30);
    expect(loggedErrors(logged)).toEqual([
      expect.objectContaining({ message: "logged" }),
    ]);
  });

  it("rejects an unknown behavior", async () => {
    await expect(
      createPage().removeAllListeners("pageerror", {
        behavior: "later" as "wait",
      })
    ).rejects.toThrow("behavior: expected one of (wait|ignoreErrors|default)");
  });
});
