import { describe, expect, it } from "vitest";

import { captureAriaSnapshot } from "@ayme-dev/playwright-browser";

describe("Playwright browser capture", () => {
  it("captures distilled and full text with refs from the same DOM capture", () => {
    document.body.innerHTML = `
      <main>
        <h1 style="pointer-events: none">Account settings</h1>
        <button type="button">Save changes</button>
      </main>
    `;
    const heading = document.querySelector("h1");
    const button = document.querySelector("button");
    if (!heading) throw new Error("Expected the test heading to exist.");
    if (!button) throw new Error("Expected the test button to exist.");

    const result = captureAriaSnapshot(document.body);

    expect(Object.keys(result)).toEqual([
      "distilledText",
      "fullText",
      "refsByElement",
    ]);
    const headingRef = result.refsByElement.get(heading);
    expect(headingRef).toMatch(/^e\d+$/);
    const distilledHeading = result.distilledText
      .split("\n")
      .find((line) => line.includes('heading "Account settings"'));
    const fullHeading = result.fullText
      .split("\n")
      .find((line) => line.includes('heading "Account settings"'));
    expect(distilledHeading).toContain(`[ref=${headingRef}]`);
    expect(fullHeading).toContain(`[ref=${headingRef}]`);

    const buttonRef = result.refsByElement.get(button);
    expect(buttonRef).toMatch(/^e\d+$/);
    expect(result.distilledText).toContain(
      `button "Save changes" [ref=${buttonRef}]`
    );
    expect(result.fullText).toContain(
      `button "Save changes" [ref=${buttonRef}]`
    );
  });
});
