import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.selectText", () => {
  it("selects the full text content of an input", async () => {
    document.body.innerHTML = `<input id=input value=hello />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").selectText();

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  // Pinned dom.ts `selectText` runs `checkElementStates(['visible'])` only
  // when `force` is unset.
  it("skips the visible wait with force", async () => {
    document.body.innerHTML = `<input id=input value=hello style="display:none" />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await expect(
      page.locator("#input").selectText({ timeout: 20 })
    ).rejects.toThrow(/Timeout 20ms exceeded/);
    await page.locator("#input").selectText({ force: true });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  // Contract coverage: the upstream invisible-element spec drives only the
  // ElementHandle form. Pinned dom.ts `selectText` logs each visibility wait.
  it("names itself and logs the visibility wait when it times out", async () => {
    document.body.innerHTML = `<input id=input value=hello style="display:none" />`;
    const error = await createPage()
      .locator("#input")
      .selectText({ timeout: 100 })
      .catch((error: Error) => error);

    expect(error?.message).toMatch(
      /^locator\.selectText: Timeout 100ms exceeded\./
    );
    // Repeats collapse to `N × …` as pinned server/callLog.ts renders them.
    expect(error?.message).toContain("\nCall log:\n");
    expect(error?.message).toContain("- attempting selectText action\n");
    expect(error?.message).toMatch(
      /waiting for element to be visible\n\s+- element is not visible\n/
    );
    expect(error?.message).toContain("- retrying selectText action\n");
  });
});
