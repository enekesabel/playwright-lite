import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

// Contract coverage for the document-scoped wait. The corpus proves hash,
// pushState, replaceState, traversal and URL matching through clicks; these
// cover what it cannot reach: waiting for the next navigation rather than the
// current URL, the lifecycle wait after it, and this package's timeout.

let originalURL: string | undefined;

afterEach(() => {
  if (originalURL) history.replaceState({}, "", originalURL);
  originalURL = undefined;
});

async function withReadyState<T>(
  state: DocumentReadyState,
  run: () => Promise<T>
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: state,
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(document, "readyState", descriptor);
    else delete (document as { readyState?: DocumentReadyState }).readyState;
  }
}

describe("Page.waitForNavigation", () => {
  it("resolves with null on a hash change and leaves host history APIs alone", async () => {
    originalURL = location.href;
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    const page = createPage();
    const waiting = page.waitForNavigation({ timeout: 100 });

    location.hash = "navigated";

    await expect(waiting).resolves.toBeNull();
    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
  });

  it("waits for the next navigation even when the current URL matches", async () => {
    originalURL = location.href;
    const page = createPage();
    let resolved = false;
    const waiting = page
      .waitForNavigation({ url: "**/*", timeout: 200 })
      .then((response) => {
        resolved = true;
        return response;
      });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolved).toBe(false);
    history.pushState({}, "", "#next");

    await expect(waiting).resolves.toBeNull();
  });

  it("skips navigations whose URL does not match", async () => {
    originalURL = location.href;
    const page = createPage();
    const seen: string[] = [];
    const waiting = page.waitForNavigation({
      url: (url) => {
        seen.push(url.hash);
        return url.hash === "#match";
      },
      timeout: 200,
    });

    history.pushState({}, "", "#other");
    await new Promise((resolve) => setTimeout(resolve, 50));
    history.pushState({}, "", "#match");

    await expect(waiting).resolves.toBeNull();
    expect(seen).toEqual(["#other", "#match"]);
  });

  it("resolves with null on same-document history traversal", async () => {
    originalURL = location.href;
    const page = createPage();
    history.pushState({}, "", "#first");
    history.pushState({}, "", "#second");

    const back = page.waitForNavigation({ timeout: 200 });
    history.back();
    await expect(back).resolves.toBeNull();
    expect(location.hash).toBe("#first");

    const forward = page.waitForNavigation({ timeout: 200 });
    history.forward();
    await expect(forward).resolves.toBeNull();
    expect(location.hash).toBe("#second");
  });

  it("waits for the lifecycle state after a matching navigation", async () => {
    originalURL = location.href;
    await withReadyState("loading", async () => {
      const page = createPage();
      let resolved = false;
      const waiting = page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 200 })
        .then(() => (resolved = true));

      history.pushState({}, "", "#loading");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(resolved).toBe(false);

      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "interactive",
      });
      document.dispatchEvent(new Event("readystatechange"));

      await expect(waiting).resolves.toBe(true);
    });
  });

  it("resolves at commit as soon as the navigation is observed", async () => {
    originalURL = location.href;
    await withReadyState("loading", async () => {
      const page = createPage();
      const waiting = page.waitForNavigation({
        waitUntil: "commit",
        timeout: 100,
      });

      history.replaceState({}, "", "#committed");

      await expect(waiting).resolves.toBeNull();
    });
  });

  it("uses the navigation timeout and names the API", async () => {
    const page = createPage({ navigationTimeout: 15 });
    await expect(page.waitForNavigation()).rejects.toThrow(
      "page.waitForNavigation: Timeout 15ms exceeded."
    );
  });

  it("validates waitUntil", async () => {
    await expect(
      createPage().waitForNavigation({ waitUntil: "bad" as "load" })
    ).rejects.toThrow(
      "waitUntil: expected one of (load|domcontentloaded|networkidle|commit)"
    );
  });
});
