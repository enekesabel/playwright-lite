import { describe, expect, it } from "vitest";

import { framePage, stateAfter } from "./history";
import { assetUrl } from "./network";

describe("Page.reload", () => {
  it("replaces the document and does not settle in the destroyed one", async () => {
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
    // The old document is destroyed with its timers, so neither success nor
    // the timeout is reported there. A top-level document restored from the
    // back/forward cache would resume its timers; this frame is not restored.
    await expect(stateAfter(reload, 1_200)).resolves.toBe("pending");
  });
});
