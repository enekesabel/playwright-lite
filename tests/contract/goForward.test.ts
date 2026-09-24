import { describe, expect, it } from "vitest";

import { framePage } from "./history";
import { assetUrl } from "./network";

describe("Page.goForward", () => {
  it("resolves to null without traversing when there is no entry", async () => {
    const { page, frameWindow } = await framePage(assetUrl());

    await expect(page.goForward()).resolves.toBeNull();
    expect(frameWindow().location.href).toBe(assetUrl());
  });
});
