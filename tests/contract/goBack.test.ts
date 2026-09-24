import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { framePage, stateAfter, stubLoading } from "./history";
import { assetUrl } from "./network";

let originalURL: string | undefined;

afterEach(() => {
  if (originalURL) history.replaceState({}, "", originalURL);
  originalURL = undefined;
});

describe("Page.goBack", () => {
  it("resolves to null without traversing when there is no entry", async () => {
    const { page, frameWindow } = await framePage(assetUrl());

    await expect(page.goBack()).resolves.toBeNull();
    expect(frameWindow().location.href).toBe(assetUrl());
  });

  it("resolves after traversing to an entry with the same URL", async () => {
    // Playwright resolves on the browser's same-document navigation, which a
    // traversal reports even when the URL stays the same.
    originalURL = location.href;
    history.pushState({ entry: 1 }, "");
    history.pushState({ entry: 2 }, "");

    await expect(createPage().goBack({ timeout: 1_000 })).resolves.toBeNull();
    expect(history.state).toEqual({ entry: 1 });
  });

  it("waits for the requested lifecycle state after the traversal", async () => {
    originalURL = location.href;
    history.pushState({}, "", "#first");
    history.pushState({}, "", "#second");
    const restore = stubLoading();
    try {
      const page = createPage();
      await expect(
        page.goBack({ waitUntil: "commit", timeout: 1_000 })
      ).resolves.toBeNull();
      expect(location.hash).toBe("#first");

      history.pushState({}, "", "#third");
      const loading = page.goBack({ timeout: 1_000 });
      await expect(stateAfter(loading, 100)).resolves.toBe("pending");
      expect(location.hash).toBe("#first");

      restore();
      document.dispatchEvent(new Event("readystatechange"));
      await expect(loading).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("starts a cross-document traversal and does not settle in the destroyed document", async () => {
    const { page, nextLoad, frameWindow } = await framePage(
      assetUrl(),
      assetUrl("?second")
    );
    const replaced = nextLoad();

    const traversal = page.goBack({ timeout: 1_000 });
    await replaced;

    expect(frameWindow().location.href).toBe(assetUrl());
    // The old document is destroyed with its timers, so neither success nor
    // the timeout is reported there. A top-level document restored from the
    // back/forward cache would resume its timers; this frame is not restored.
    await expect(stateAfter(traversal, 1_200)).resolves.toBe("pending");
  });

  it("rejects with a named error without the Navigation API", async () => {
    const { page, frameWindow } = await framePage(assetUrl());
    Object.defineProperty(frameWindow(), "navigation", {
      configurable: true,
      value: undefined,
    });

    await expect(page.goBack()).rejects.toThrow(
      "page.goBack: requires the Navigation API, which this browser does not provide"
    );
    expect(frameWindow().location.href).toBe(assetUrl());
  });
});
