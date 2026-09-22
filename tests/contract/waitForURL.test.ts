import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

let originalURL: string | undefined;

afterEach(() => {
  if (originalURL) history.replaceState({}, "", originalURL);
  originalURL = undefined;
});

describe("Page.waitForURL", () => {
  it("observes hash changes and leaves host history APIs alone", async () => {
    originalURL = location.href;
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    const page = createPage();
    const waiting = page.waitForURL("**/*#section", { timeout: 100 });

    history.pushState({}, "", "#section");

    await expect(waiting).resolves.toBeUndefined();
    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
  });

  it("observes pushState, replaceState, and history traversal", async () => {
    originalURL = location.href;
    const page = createPage();

    history.pushState({}, "", "#first");
    await expect(page.waitForURL("**/*#first")).resolves.toBeUndefined();
    history.replaceState({}, "", "#second");
    await expect(page.waitForURL(/#second$/)).resolves.toBeUndefined();

    history.pushState({}, "", "#third");
    const back = page.waitForURL((url) => url.hash === "#second", {
      timeout: 100,
    });
    history.back();
    await expect(back).resolves.toBeUndefined();

    const forward = page.waitForURL("**/*#third", { timeout: 100 });
    history.forward();
    await expect(forward).resolves.toBeUndefined();
  });

  it("resolves an already matching URL at commit", async () => {
    const page = createPage();
    await expect(
      page.waitForURL(location.href, { waitUntil: "commit" })
    ).resolves.toBeUndefined();
  });

  it("resets global regular expressions before matching", async () => {
    const page = createPage();
    const match = new RegExp(
      location.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    );
    match.lastIndex = 100;

    await expect(page.waitForURL(match)).resolves.toBeUndefined();
  });

  it("supports the pinned empty and URLPattern match forms", async () => {
    const page = createPage();
    await expect(page.waitForURL("")).resolves.toBeUndefined();

    if (typeof URLPattern === "function") {
      const pattern = new URLPattern({ pathname: location.pathname });
      await expect(page.waitForURL(pattern)).resolves.toBeUndefined();
    }
  });

  it("normalizes the case-insensitive part of an absolute URL", async () => {
    const page = createPage();
    const url =
      `${location.protocol.toUpperCase()}//${location.host.toUpperCase()}` +
      location.href.slice(location.origin.length);

    await expect(page.waitForURL(url)).resolves.toBeUndefined();
  });

  it("uses the navigation timeout and names the API", async () => {
    const page = createPage({ navigationTimeout: 15 });
    await expect(page.waitForURL("**/*#never")).rejects.toThrow(
      "page.waitForURL: Timeout 15ms exceeded."
    );
  });

  it("lets a matching URL win the final abort race", async () => {
    originalURL = location.href;
    const controller = new AbortController();
    const waiting = createPage().waitForURL("**/*#final", {
      signal: controller.signal,
      timeout: 0,
    });

    history.pushState({}, "", "#final");
    controller.abort(new Error("stop"));

    await expect(waiting).resolves.toBeUndefined();
  });

  it("latches a URL predicate match before waiting for lifecycle", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    let calls = 0;

    try {
      const waiting = createPage().waitForURL(() => ++calls === 1, {
        waitUntil: "domcontentloaded",
        timeout: 100,
      });
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "interactive",
      });
      document.dispatchEvent(new Event("readystatechange"));

      await expect(waiting).resolves.toBeUndefined();
      expect(calls).toBe(1);
    } finally {
      if (descriptor) Object.defineProperty(document, "readyState", descriptor);
      else delete (document as { readyState?: DocumentReadyState }).readyState;
    }
  });

  it("waits for network idle after the URL matched", async () => {
    const page = createPage();
    const waiting = page.waitForURL(location.href, {
      waitUntil: "networkidle",
    });
    const fetched = fetch(
      new URL("/__delay?ms=100&type=text", location.href)
    ).then((response) => response.text().then(() => performance.now()));

    await waiting;

    expect(performance.now() - (await fetched)).toBeGreaterThanOrEqual(490);
  });
});
