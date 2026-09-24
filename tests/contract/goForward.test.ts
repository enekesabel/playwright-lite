import { describe, expect, it } from "vitest";

import { framePage } from "./history";
import { assetUrl } from "./network";

describe("Page.goForward", () => {
  it("resolves to null without traversing when there is no entry", async () => {
    const { page, frameWindow } = await framePage(assetUrl());

    await expect(page.goForward()).resolves.toBeNull();
    expect(frameWindow().location.href).toBe(assetUrl());
  });

  it("rejects with a named error without the Navigation API", async () => {
    const { page, frameWindow } = await framePage(assetUrl());
    Object.defineProperty(frameWindow(), "navigation", {
      configurable: true,
      value: undefined,
    });

    await expect(page.goForward()).rejects.toThrow(
      "page.goForward: requires the Navigation API, which this browser does not provide"
    );
    expect(frameWindow().location.href).toBe(assetUrl());
  });
});
