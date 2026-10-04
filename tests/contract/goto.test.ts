/* eslint-disable @typescript-eslint/no-explicit-any -- the timer spy forwards arbitrary setTimeout arguments, and the networkidle0 alias is a waitUntil value the typings reject */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { framePage } from "./history";
import { assetUrl, idleWindow } from "./network";

describe("Page.goto", () => {
  it("waits for network idle after same-document navigation through the networkidle0 alias", async () => {
    // Pinned verifyLoadState accepts networkidle0 as networkidle, so the
    // alias must not be reported as an unknown lifecycle event.
    const started = performance.now();
    await expect(
      createPage().goto("#networkidle0", { waitUntil: "networkidle0" as any })
    ).resolves.toBeNull();
    expect(location.hash).toBe("#networkidle0");
    expect(performance.now() - started).toBeGreaterThanOrEqual(idleWindow);
  });

  it("applies configured and explicit navigation defaults to same-document goto", async () => {
    const originalSetTimeout = window.setTimeout;
    const navigationTimeouts: number[] = [];
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: any[]
    ) => {
      if (timeout !== undefined) navigationTimeouts.push(timeout);
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;

    try {
      const page = createPage({ navigationTimeout: 7 });

      await expect(page.goto("#configured")).resolves.toBeNull();
      expect(navigationTimeouts).toContain(7);

      await expect(page.goto("#explicit", { timeout: 13 })).resolves.toBeNull();
      expect(navigationTimeouts).toContain(13);
      const scheduledBeforeZero = navigationTimeouts.length;
      await expect(page.goto("#zero", { timeout: 0 })).resolves.toBeNull();
      expect(navigationTimeouts).toHaveLength(scheduledBeforeZero);
    } finally {
      window.setTimeout = originalSetTimeout;
    }
  });

  it("resolves null when the document's navigate listener keeps the navigation in the document", async () => {
    // Playwright navigates from outside the page, where the listener cannot
    // intercept it, and returns the new document's Response. Here the
    // navigation commits in the same document, which Playwright resolves null.
    const { page, frameWindow } = await framePage(assetUrl());
    const document = frameWindow().document;
    const view = document.createElement("div");
    document.body.append(view);
    frameWindow().navigation.addEventListener("navigate", (event) => {
      const url = new URL(event.destination.url);
      if (event.canIntercept && url.pathname.startsWith("/app/"))
        event.intercept({
          handler: async () => {
            view.textContent = url.pathname;
          },
        });
    });

    await expect(
      page.goto("/app/route2", { timeout: 1_000 })
    ).resolves.toBeNull();
    expect(frameWindow().location.pathname).toBe("/app/route2");
    expect(frameWindow().document).toBe(document);
    expect(view.textContent).toBe("/app/route2");
  });

  it("waits until its timeout when the page cancels the navigation", async () => {
    const { page, frameWindow } = await framePage(assetUrl());
    frameWindow().navigation.addEventListener("navigate", (event) =>
      event.preventDefault()
    );

    await expect(page.goto("/app/route2", { timeout: 100 })).rejects.toThrow(
      "page.goto: Timeout 100ms exceeded."
    );
    expect(frameWindow().location.href).toBe(assetUrl());
  });

  it("resolves null for a fragment navigation without the Navigation API", async () => {
    const { page, frameWindow } = await framePage(assetUrl());
    Object.defineProperty(frameWindow(), "navigation", {
      configurable: true,
      value: undefined,
    });

    await expect(
      page.goto("#fragment", { timeout: 1_000 })
    ).resolves.toBeNull();
    expect(frameWindow().location.href).toBe(assetUrl() + "#fragment");
  });
});
