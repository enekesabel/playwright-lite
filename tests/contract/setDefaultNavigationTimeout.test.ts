/* eslint-disable @typescript-eslint/no-explicit-any -- the timer spy forwards arbitrary setTimeout arguments */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.setDefaultNavigationTimeout", () => {
  it("applies the runtime navigation default to same-document goto", async () => {
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

      page.setDefaultNavigationTimeout(11);
      await expect(page.goto("#runtime")).resolves.toBeNull();
      expect(navigationTimeouts).toContain(11);
    } finally {
      window.setTimeout = originalSetTimeout;
    }
  });
});
