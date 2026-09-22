import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import { listenerFailures, swallowWindowErrors } from "./pageEvents";

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
    reject({});
    reject("Custom: detail");
    report({ name: "Named", message: "ignored" });
    expect(errors.map((e) => [e.name, e.message, e.stack])).toEqual([
      ["", "Object", ""],
      ["Custom", "detail", ""],
      ["Named", "Object", ""],
    ]);
  });

  it("logs a throwing or rejecting listener and keeps delivering to the others", async () => {
    const logged = vi
      .spyOn(window.console, "error")
      .mockImplementation(() => {});
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
    const prefix = 'page.on("pageerror"): listener failed';
    expect(listenerFailures(logged)).toEqual([
      [prefix, expect.objectContaining({ message: "listener failed" })],
      [prefix, undefined],
      [prefix, expect.objectContaining({ message: "listener rejected" })],
    ]);
  });
});
