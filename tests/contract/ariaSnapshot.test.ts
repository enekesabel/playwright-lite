/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.ariaSnapshot", () => {
  it("captures a locator subtree with the pinned mode and depth options", async () => {
    document.body.innerHTML = `
        <ul id="target"><li>First</li><li><ul><li>Nested</li></ul></li></ul>
      `;
    const page = createPage();

    const snapshot = await (page as any)
      .locator("#target")
      .ariaSnapshot({ mode: "ai", depth: 1 });

    expect(snapshot).toContain("listitem [ref=");
    expect(snapshot).not.toContain("Nested");
  });

  it("waits for a default-mode target and honors an in-flight abort", async () => {
    const page = createPage();

    document.body.innerHTML = "";
    window.setTimeout(
      () => (document.body.innerHTML = "<h1 id=ready>Ready</h1>"),
      25
    );
    await expect(
      (page as any).locator("#ready").ariaSnapshot({ timeout: 100 })
    ).resolves.toContain('heading "Ready" [level=1]');

    const cancelled = new AbortController();
    window.setTimeout(() => cancelled.abort("cancel snapshot"), 10);
    const inFlightError = await (page as any)
      .locator("#missing")
      .ariaSnapshot({ timeout: 100, signal: cancelled.signal })
      .then(
        () => undefined,
        (error: Error) => error
      );
    expect(inFlightError?.name).toBe("AbortError");
    expect(inFlightError?.message).toBe(
      "cancel snapshot\nCall log:\n  - operation was aborted: cancel snapshot"
    );
    expect(inFlightError?.cause).toBe("cancel snapshot");
  });
});

describe("Page.ariaSnapshot", () => {
  it("captures the current document through the compiled InjectedScript", async () => {
    document.body.innerHTML = "<h1>Accessible title</h1>";
    const page = createPage();

    await expect((page as any).ariaSnapshot()).resolves.toContain(
      'heading "Accessible title" [level=1]'
    );
  });

  it("rejects a pre-aborted signal", async () => {
    const page = createPage();
    const aborted = new AbortController();
    aborted.abort("stop snapshot");

    const preAbortedError = await (page as any)
      .ariaSnapshot({ signal: aborted.signal })
      .then(
        () => undefined,
        (error: Error) => error
      );
    expect(preAbortedError?.name).toBe("AbortError");
    expect(preAbortedError?.message).toBe("The operation was aborted");
    expect(preAbortedError?.cause).toBe("stop snapshot");
  });
});
