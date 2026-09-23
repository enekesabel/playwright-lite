import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import { listenedPages, report, swallowWindowErrors } from "./pageEvents";
import { assetUrl, contractUrl, restoreFetch, xhrMethods } from "./network";
import { restoreConsole } from "./console";

swallowWindowErrors();

describe("Page.off", () => {
  it("keeps the window pageerror listeners registered from page creation, independent of subscription", () => {
    const added = vi.spyOn(window, "addEventListener");
    const page = createPage();
    const types = (spy: typeof added) =>
      spy.mock.calls.map(([type]) => type).sort();
    expect(types(added)).toEqual(["error", "unhandledrejection"]);

    const removed = vi.spyOn(window, "removeEventListener");
    const first = vi.fn();
    const second = vi.fn();

    page.on("load", () => {});
    page.on("pageerror", first).on("pageerror", second);
    // Subscribing never re-registers: the window listeners already exist.
    expect(added).toHaveBeenCalledTimes(2);

    page.off("pageerror", first);
    page.off("pageerror", second);
    // No dispose exists to remove them on, so they stay registered.
    expect(removed).not.toHaveBeenCalled();

    report(new Error("after"));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  // ── Network events ──────────────────────────────────────────────

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

  it("restores window.fetch only after every page has unsubscribed", async () => {
    const native = window.fetch;
    const first = createPage();
    const second = createPage();
    const seen: string[] = [];
    const onFirst = (request: { url(): string }) =>
      seen.push(`first:${request.url()}`);
    const onSecond = (request: { url(): string }) =>
      seen.push(`second:${request.url()}`);

    first.on("request", onFirst);
    second.on("request", onSecond);
    expect(window.fetch).not.toBe(native);

    await window.fetch(assetUrl("?shared"));

    first.off("request", onFirst);
    expect(window.fetch).not.toBe(native);
    second.off("request", onSecond);
    expect(window.fetch).toBe(native);

    expect(seen).toEqual([
      `first:${assetUrl("?shared")}`,
      `second:${assetUrl("?shared")}`,
    ]);
  });

  // ── XMLHttpRequest ──────────────────────────────────────────────

  it("restores the XMLHttpRequest methods with the last network listener", () => {
    const native = xhrMethods();
    const page = createPage();
    const listener = () => {};

    page.on("request", listener);
    expect(xhrMethods()).not.toEqual(native);

    page.off("request", listener);
    expect(xhrMethods()).toEqual(native);
  });

  it("restores the XMLHttpRequest methods after a send the platform rejected", () => {
    const native = xhrMethods();
    const page = createPage();
    const listener = () => {};
    page.on("request", listener);

    // The InvalidStateError must not leave a subscription behind that keeps
    // the wrappers installed past the last listener.
    expect(() => new XMLHttpRequest().send()).toThrow(DOMException);

    page.off("request", listener);
    expect(xhrMethods()).toEqual(native);
  });

  // ── Dialog events ──────────────────────────────────────────────

  const dialogPage = listenedPages();

  it("restores window.alert/confirm/prompt once the last dialog listener leaves", () => {
    const nativeAlert = window.alert;
    const nativeConfirm = window.confirm;
    const nativePrompt = window.prompt;
    const page = dialogPage();
    const listener = () => {};

    page.on("dialog", listener);
    expect(window.alert).not.toBe(nativeAlert);
    expect(window.confirm).not.toBe(nativeConfirm);
    expect(window.prompt).not.toBe(nativePrompt);

    page.off("dialog", listener);
    expect(window.alert).toBe(nativeAlert);
    expect(window.confirm).toBe(nativeConfirm);
    expect(window.prompt).toBe(nativePrompt);
  });

  // ── Console events ──────────────────────────────────────────────

  restoreConsole();

  it("restores console.log with the last console listener", () => {
    const native = console.log;
    const page = createPage();
    const first = () => {};
    const second = () => {};

    page.on("console", first);
    expect(console.log).not.toBe(native);
    page.once("console", second);
    page.off("console", first);
    expect(console.log).not.toBe(native);
    page.off("console", second);
    expect(console.log).toBe(native);
  });

  it("restores console.log only after every page has unsubscribed", () => {
    const native = console.log;
    const first = createPage();
    const second = createPage();
    const seen: string[] = [];
    const onFirst = (m: { text(): string }) => seen.push(`first:${m.text()}`);
    const onSecond = (m: { text(): string }) => seen.push(`second:${m.text()}`);

    first.on("console", onFirst);
    second.on("console", onSecond);
    expect(console.log).not.toBe(native);

    console.log("shared");

    first.off("console", onFirst);
    expect(console.log).not.toBe(native);
    second.off("console", onSecond);
    expect(console.log).toBe(native);

    expect(seen).toEqual(["first:shared", "second:shared"]);
  });
});
