import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { delayedUrl, idleWindow, networkPages, sendXhr } from "./network";

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

  it("lets a reached load state win the final timeout race", async () => {
    await withReadyState("loading", async () => {
      const waiting = createPage().waitForLoadState("domcontentloaded", {
        timeout: 5,
      });
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "interactive",
      });

      await expect(waiting).resolves.toBeUndefined();
    });
  });

  const page = networkPages();
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function addImage(src: string) {
    const image = document.createElement("img");
    const loaded = new Promise<number>((resolve) =>
      image.addEventListener("load", () => resolve(performance.now()))
    );
    image.src = src;
    document.body.append(image);
    cleanups.push(() => image.remove());
    return { image, loaded };
  }

  it("resolves networkidle 500 ms after the last fetch and XMLHttpRequest ended", async () => {
    const waiting = page().waitForLoadState("networkidle");
    const fetched = fetch(delayedUrl(200)).then(() => performance.now());
    const { ended } = sendXhr(delayedUrl(300));
    const xhrEnded = ended.then(() => performance.now());

    await waiting;
    const resolvedAt = performance.now();

    expect(resolvedAt - (await fetched)).toBeGreaterThanOrEqual(idleWindow);
    expect(resolvedAt - (await xhrEnded)).toBeGreaterThanOrEqual(idleWindow);
  });

  it("holds networkidle for a fetch reported to an earlier subscriber", async () => {
    const listening = page();
    listening.on("request", () => {});
    const fetched = fetch(delayedUrl(300)).then((response) =>
      response.text().then(() => performance.now())
    );

    await page().waitForLoadState("networkidle");

    expect(performance.now() - (await fetched)).toBeGreaterThanOrEqual(
      idleWindow
    );
  });

  it("wraps fetch only while a networkidle wait is pending", async () => {
    const original = window.fetch;
    const waiting = page().waitForLoadState("networkidle");
    expect(window.fetch).not.toBe(original);
    await waiting;
    expect(window.fetch).toBe(original);
  });

  it("does not hold networkidle for a favicon request, as Playwright excludes it", async () => {
    const controller = new AbortController();
    cleanups.push(() => controller.abort());
    let settled = false;
    const waiting = page().waitForLoadState("networkidle");
    fetch(delayedUrl(1_500, "favicon.ico"), {
      signal: controller.signal,
    }).then(
      () => (settled = true),
      () => (settled = true)
    );

    await waiting;

    expect(settled).toBe(false);
  });

  it("limitation: only fetch and XMLHttpRequest hold networkidle, so it resolves while a slow image is still loading", async () => {
    const { image } = addImage(delayedUrl(1_500));

    await page().waitForLoadState("networkidle");

    expect(image.complete).toBe(false);
  });

  it("limitation: a fetch started before the first subscription is invisible and does not hold networkidle", async () => {
    const controller = new AbortController();
    cleanups.push(() => controller.abort());
    let settled = false;
    fetch(delayedUrl(1_500), { signal: controller.signal }).then(
      () => (settled = true),
      () => (settled = true)
    );

    await page().waitForLoadState("networkidle");

    expect(settled).toBe(false);
  });

  it("limitation: an image completing during the 500 ms window restarts it instead of holding it", async () => {
    const waiting = page().waitForLoadState("networkidle");
    const { image, loaded } = addImage(delayedUrl(300));

    await waiting;
    const resolvedAt = performance.now();

    await loaded;
    const [entry] = performance.getEntriesByName(
      image.src
    ) as PerformanceResourceTiming[];
    expect(resolvedAt - entry.responseEnd).toBeGreaterThanOrEqual(idleWindow);
  });
});
