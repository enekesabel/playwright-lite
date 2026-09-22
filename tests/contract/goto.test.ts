/* eslint-disable @typescript-eslint/no-explicit-any -- the timer spy forwards arbitrary setTimeout arguments, and the networkidle0 alias is a waitUntil value the typings reject */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.goto", () => {
  it("waits for network idle after same-document navigation, also through the networkidle0 alias", async () => {
    // Pinned verifyLoadState accepts networkidle0 as networkidle, so the
    // alias must not be reported as an unknown lifecycle event.
    for (const waitUntil of ["networkidle", "networkidle0"]) {
      const started = performance.now();
      await expect(
        createPage().goto(`#${waitUntil}`, { waitUntil: waitUntil as any })
      ).resolves.toBeNull();
      expect(location.hash).toBe(`#${waitUntil}`);
      expect(performance.now() - started).toBeGreaterThanOrEqual(490);
    }
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
});
