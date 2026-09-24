import { describe, expect, it } from "vitest";

import { framePage, stateAfter } from "./history";
import { assetUrl } from "./network";

describe("Page.reload", () => {
  it("replaces the document and never resolves in the old one", async () => {
    const { page, nextLoad, frameWindow } = await framePage(assetUrl());
    const oldWindow = frameWindow();
    (oldWindow as { marker?: boolean }).marker = true;
    const replaced = nextLoad();

    const reload = page.reload({ timeout: 1_000 });
    // Pinned reload requires a new document: a same-document navigation
    // while it is pending does not resolve it.
    oldWindow.history.pushState({}, "", "#pushed");
    await expect(stateAfter(reload, 30)).resolves.toBe("pending");
    await replaced;

    expect((frameWindow() as { marker?: boolean }).marker).toBeUndefined();
    // The old document's realm ended with its timers: neither success nor the
    // timeout is ever reported.
    await expect(stateAfter(reload, 1_200)).resolves.toBe("pending");
  });
});
