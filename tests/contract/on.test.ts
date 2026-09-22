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

describe("Page.on", () => {
  it("accepts an unknown event name silently", () => {
    const page = createPage();
    expect(page.on("unknown" as "load", () => {})).toBe(page);
  });

  it("delivers a thrown Error as the pageerror payload", () => {
    const page = createPage();
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    const thrown = new Error("boom");
    report(thrown);
    expect(errors).toEqual([thrown]);
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
    report({ name: "Named", message: "ignored" });
    expect(errors.map((e) => [e.name, e.message, e.stack])).toEqual([
      ["", "Object", ""],
      ["Custom", "detail", ""],
      ["Named", "Object", ""],
    ]);
  });

  it("logs a throwing or rejecting listener and keeps delivering to the others", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = createPage();
    const payloads: Error[] = [];
    page.on("pageerror", () => {
      throw new Error("listener failed");
    });
    page.on("pageerror", () => {
      throw undefined;
    });
    page.on("pageerror", () => Promise.reject(new Error("listener rejected")));
    page.on("pageerror", (error) => payloads.push(error));

    report(new Error("first"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(payloads.map((e) => e.message)).toEqual(["first"]);
    // The vitest runner also logs the dispatched ErrorEvent itself.
    expect(
      logged.mock.calls.filter(([value]) => !(value instanceof Event))
    ).toEqual([
      [expect.objectContaining({ message: "listener failed" })],
      [undefined],
      [expect.objectContaining({ message: "listener rejected" })],
    ]);
  });
});
