import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

function waitForRuntimeLoadState(
  page: ReturnType<typeof createPage>,
  state: string
): Promise<void> {
  return (
    page as unknown as {
      waitForLoadState(state?: string): Promise<void>;
    }
  ).waitForLoadState(state);
}

async function withReadyState<T>(
  state: DocumentReadyState,
  run: () => Promise<T>
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: state,
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(document, "readyState", descriptor);
    else delete (document as { readyState?: DocumentReadyState }).readyState;
  }
}

describe("Page.waitForLoadState", () => {
  it("resolves immediately for lifecycle states already reached", async () => {
    const page = createPage();
    await expect(page.waitForLoadState()).resolves.toBeUndefined();
    await expect(
      page.waitForLoadState("domcontentloaded")
    ).resolves.toBeUndefined();
    await expect(
      waitForRuntimeLoadState(page, "commit")
    ).resolves.toBeUndefined();
  });

  it("waits for the requested lifecycle event", async () => {
    await withReadyState("loading", async () => {
      const page = createPage();
      const waiting = page.waitForLoadState("domcontentloaded", {
        timeout: 100,
      });

      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "interactive",
      });
      document.dispatchEvent(new Event("readystatechange"));

      await expect(waiting).resolves.toBeUndefined();
    });
  });

  it("uses navigation timeout settings and validates invalid states", async () => {
    await withReadyState("loading", async () => {
      const page = createPage({ navigationTimeout: 15 });
      await expect(page.waitForLoadState()).rejects.toThrow(
        "page.waitForLoadState: Timeout 15ms exceeded."
      );
    });

    await expect(waitForRuntimeLoadState(createPage(), "bad")).rejects.toThrow(
      "state: expected one of (load|domcontentloaded|networkidle|commit)"
    );
  });

  it("rejects network idle instead of approximating browser request tracking", async () => {
    await expect(createPage().waitForLoadState("networkidle")).rejects.toThrow(
      "Unsupported state value: networkidle"
    );
    await expect(
      waitForRuntimeLoadState(createPage(), "networkidle0")
    ).rejects.toThrow("Unsupported state value: networkidle");
  });
});
