import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import {
  listenerFailures,
  restoreURL,
  swallowWindowErrors,
} from "./pageEvents";

swallowWindowErrors();
restoreURL();

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

  const nextNavigation = (page: ReturnType<typeof createPage>) =>
    page.waitForEvent("framenavigated", { timeout: 500 });

  it("fires framenavigated with the main frame on pushState, replaceState, hash change and back", async () => {
    const start = location.href;
    const page = createPage();
    const frames: unknown[] = [];
    page.on("framenavigated", (frame) => frames.push(frame));

    let navigated = nextNavigation(page);
    history.pushState({}, "", "#pushed");
    await navigated;
    expect(page.url()).toBe(`${start}#pushed`);

    navigated = nextNavigation(page);
    history.replaceState({}, "", "#replaced");
    await navigated;
    expect(page.url()).toBe(`${start}#replaced`);

    navigated = nextNavigation(page);
    location.hash = "#hash";
    await navigated;
    expect(page.url()).toBe(`${start}#hash`);

    navigated = nextNavigation(page);
    history.back();
    await navigated;
    expect(page.url()).toBe(`${start}#replaced`);

    expect(frames).toHaveLength(4);
    for (const frame of frames) expect(frame).toBe(page.mainFrame());
  });

  it("does not fire framenavigated while the URL stays the same", async () => {
    const page = createPage();
    const listener = vi.fn();
    page.on("framenavigated", listener);

    history.replaceState({ changed: true }, "", location.href);
    await expect(nextNavigation(page)).rejects.toThrow(
      'Timeout 500ms exceeded while waiting for event "framenavigated"'
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers framenavigated to a listener and a concurrent waitForURL alike", async () => {
    const page = createPage();
    const frames: unknown[] = [];
    page.on("framenavigated", (frame) => frames.push(frame));
    const navigated = nextNavigation(page);
    const reached = page.waitForURL((url) => url.hash === "#shared", {
      waitUntil: "commit",
      timeout: 500,
    });

    history.pushState({}, "", "#shared");
    await navigated;
    await expect(reached).resolves.toBeUndefined();
    expect(frames).toEqual([page.mainFrame()]);
  });
});
