import { afterEach, describe, expect, it, vi } from "vitest";

import { ADAPTER_TIMEOUT_ERROR } from "../../src/errors";
import { createPage } from "../../src/index";

afterEach(() => {
  vi.restoreAllMocks();
});

const report = (error: unknown) =>
  window.dispatchEvent(new ErrorEvent("error", { error }));

describe("Page.waitForEvent", () => {
  it("names the event in its timeout error", async () => {
    const error: Error & { [ADAPTER_TIMEOUT_ERROR]?: boolean } =
      await createPage()
        .waitForEvent("pageerror", { timeout: 15 })
        .then(
          () => {
            throw new Error("resolved");
          },
          (error) => error
        );
    expect(error.name).toBe("TimeoutError");
    expect(error[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(error.message).toBe(
      'page.waitForEvent: Timeout 15ms exceeded while waiting for event "pageerror"'
    );
  });

  it("accepts an unknown event name silently", async () => {
    const page = createPage();
    expect(page.on("unknown" as "load", () => {})).toBe(page);
    await expect(
      page.waitForEvent("unknown" as "load", { timeout: 5 })
    ).rejects.toThrow("Timeout 5ms exceeded");
  });

  it("resolves with the payload once the predicate accepts it", async () => {
    const page = createPage();
    const seen: string[] = [];
    const waiting = page.waitForEvent("pageerror", (error) => {
      seen.push(error.message);
      return error.message === "second";
    });
    report(new Error("first"));
    report(new Error("second"));
    await expect(waiting).resolves.toMatchObject({ message: "second" });
    expect(seen).toEqual(["first", "second"]);
  });

  it("rejects with a throwing predicate", async () => {
    const waiting = createPage().waitForEvent("pageerror", () => {
      throw new Error("predicate failed");
    });
    report(new Error("any"));
    await expect(waiting).rejects.toThrow("predicate failed");
  });

  it("fires a once listener one time, prepended listeners first", () => {
    const page = createPage();
    const calls: string[] = [];
    page.once("pageerror", () => calls.push("once"));
    page.on("pageerror", () => calls.push("on"));
    page.prependListener("pageerror", () => calls.push("prepended"));
    report(new Error("1"));
    report(new Error("2"));
    expect(calls).toEqual(["prepended", "once", "on", "prepended", "on"]);
  });

  it("listens to the window only while a pageerror listener exists", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const types = (spy: typeof added) =>
      spy.mock.calls.map(([type]) => type).sort();
    const page = createPage();
    const listener = vi.fn();

    page.on("load", () => {});
    expect(added).not.toHaveBeenCalled();

    page.on("pageerror", listener).on("pageerror", () => {});
    expect(types(added)).toEqual(["error", "unhandledrejection"]);
    page.off("pageerror", listener);
    expect(removed).not.toHaveBeenCalled();
    page.removeAllListeners("pageerror");
    expect(types(removed)).toEqual(["error", "unhandledrejection"]);

    report(new Error("after"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("wraps a non-Error rejection reason like the pinned protocol mapping", () => {
    const page = createPage();
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: {},
      })
    );
    report("Custom: detail");
    expect(errors.map((e) => [e.name, e.message, e.stack])).toEqual([
      ["", "Object", ""],
      ["Custom", "detail", ""],
    ]);
  });
});
