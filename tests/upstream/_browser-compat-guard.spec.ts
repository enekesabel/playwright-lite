import { test as base, expect, type Page } from "@playwright/test";
import { createAdapterPage } from "./adapter-bridge";
import { browserTest } from "../config/browserTest";

// Transport guards, not upstream compatibility promotions. Native navigation
// establishes a document before the adapter exists; no adapter goto is faked.
const test = base.extend<{ adapterPage: Page }>({
  adapterPage: async ({ page }, use) => {
    await page.route("http://pw-lite.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<div><span>A</span><span>B</span></div><button>Target</button><input id="text"><input id="check" type="checkbox">',
    }));
    await page.goto("http://pw-lite.test/");
    await use(await createAdapterPage(page));
  },
});

async function storageRoundTrip(page: Page) {
  await page.localStorage.clear();
  await page.sessionStorage.clear();
  await page.localStorage.setItem("a", "first");
  await page.localStorage.setItem("a", "updated");
  await page.localStorage.setItem("b", "second");
  await page.sessionStorage.setItem("a", "session");
  const items = (await page.localStorage.items()).sort((a, b) => a.name.localeCompare(b.name));
  await page.localStorage.removeItem("b");
  const missing = await page.localStorage.getItem("b");
  await page.localStorage.clear();
  return {
    items,
    missing,
    empty: await page.localStorage.items(),
    session: await page.sessionStorage.getItem("a"),
  };
}

test("storage properties preserve browser results and cannot fall back to native storage", async ({ page, adapterPage }) => {
  const expected = await storageRoundTrip(page);
  for (const kind of ["localStorage", "sessionStorage"] as const)
    Object.defineProperty(page, kind, {
      configurable: true,
      get() { throw new Error(`native ${kind} must not run`); },
    });
  expect(adapterPage.localStorage).toBe(adapterPage.localStorage);
  expect(adapterPage.sessionStorage).toBe(adapterPage.sessionStorage);
  expect(await storageRoundTrip(adapterPage)).toEqual(expected);
  const entered = await page.evaluate(() => (window as any).__pwLiteEvidence.entered);
  expect(entered).toEqual(expect.arrayContaining([
    "Page.localStorage.items", "Page.localStorage.getItem",
    "Page.localStorage.setItem", "Page.localStorage.removeItem",
    "Page.localStorage.clear", "Page.sessionStorage.getItem",
  ]));
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("storage invalid arguments agree with stock Playwright and do not mutate data", async ({ page, adapterPage }) => {
  for (const candidate of [page, adapterPage]) {
    for (const kind of ["localStorage", "sessionStorage"] as const) {
      const storage = candidate[kind];
      await storage.clear();
      await storage.setItem("key", "original");
      for (const value of [undefined, null, 42, true, {}, []]) {
        await expect(storage.getItem(value as never)).rejects.toThrow("name: expected string");
        await expect(storage.removeItem(value as never)).rejects.toThrow("name: expected string");
        await expect(storage.setItem(value as never, "value")).rejects.toThrow("name: expected string");
        await expect(storage.setItem("key", value as never)).rejects.toThrow("value: expected string");
      }
      expect(await storage.items()).toEqual([{ name: "key", value: "original" }]);
    }
  }
});

test("highlight transports the actual returned disposable, its symbols and its errors", async ({ page, adapterPage }) => {
  await page.evaluate(() => {
    const host = window as any;
    host.disposalCalls = [];
    const runtime = host.__pwLiteAdapterPage;
    const locator = runtime.locator.bind(runtime);
    runtime.locator = (...args: unknown[]) => {
      const result = locator(...args);
      let calls = 0;
      result.highlight = async () => ({
        async dispose() {
          host.disposalCalls.push(`dispose:${++calls}`);
          if (calls === 1) throw new Error("disposal failed");
        },
        async [Symbol.asyncDispose]() { host.disposalCalls.push("symbol"); },
      });
      result.hideHighlight = async () => { throw new Error("do not replace the returned disposable"); };
      return result;
    };
  });
  const disposable = await adapterPage.locator("button").highlight();
  await expect(disposable.dispose()).rejects.toThrow("disposal failed");
  await disposable.dispose();
  await disposable[Symbol.asyncDispose]();
  expect(await page.evaluate(() => (window as any).disposalCalls)).toEqual([
    "dispose:1", "dispose:2", "symbol",
  ]);
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("all ElementHandle creation paths preserve synchronous asElement identity", async ({ page, adapterPage }) => {
  const root = (await adapterPage.$("div"))!;
  const handles = [
    root,
    ...(await adapterPage.$$("span")),
    (await adapterPage.waitForSelector("span"))!,
    await adapterPage.locator("div").elementHandle(),
    ...(await adapterPage.locator("span").elementHandles()),
    (await root.$("span"))!,
    ...(await root.$$("span")),
    (await root.waitForSelector("span"))!,
  ];
  for (const handle of handles) {
    expect(handle.asElement()).toBe(handle);
    expect(await handle.isVisible()).toBe(true);
    await handle.dispose();
    expect(handle.asElement()).toBe(handle);
  }
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("asElement mirrors the observed browser result rather than hard-coding self", async ({ page, adapterPage }) => {
  await page.evaluate(() => {
    const runtime = (window as any).__pwLiteAdapterPage;
    const query = runtime.$.bind(runtime);
    runtime.$ = async (...args: unknown[]) => {
      const handle = await query(...args);
      handle.asElement = () => null;
      return handle;
    };
  });
  const handle = (await adapterPage.$("button"))!;
  expect(handle.asElement()).toBeNull();
  expect(await handle.textContent()).toBe("Target");
});

test("noWaitAfter uses the pinned method-specific validation", async ({ page, adapterPage }) => {
  const ignored = { noWaitAfter: "ignored" } as never;
  for (const candidate of [page, adapterPage]) {
    await candidate.fill("#text", "value", ignored);
    await candidate.locator("#text").clear(ignored);
    await candidate.hover("button", ignored);
    await candidate.locator("button").dblclick(ignored);
    await candidate.check("#check", ignored);
    await candidate.locator("#check").uncheck(ignored);
    expect(await candidate.inputValue("#text")).toBe("");
    expect(await candidate.isChecked("#check")).toBe(false);
    await expect(candidate.click("button", ignored)).rejects.toThrow("noWaitAfter: expected boolean");
    await expect(candidate.locator("#text").press("a", ignored)).rejects.toThrow("noWaitAfter: expected boolean");
  }
});

browserTest("library-created pages use the same adapter before context cleanup", async ({ browser, server }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  expect((page as any).__pwLiteAdapter).toBe(true);
  await page.goto(server.PREFIX + "/input/button.html");
  expect(await page.locator(".mouse-helper").count()).toBe(1);
  await page.setContent("<button>Library</button>");
  expect(await page.locator("button").textContent()).toBe("Library");
  expect(await page.evaluate(() => typeof (window as any).__pwLiteAdapterPage)).toBe("object");
  await context.close();
});


base("explicit navigation setup preserves browser evidence and failures", async ({ page }) => {
  await page.route("http://pw-lite.test/**", route => route.fulfill({
    contentType: "text/html",
    body: "<button>Target</button>",
  }));
  const adapter = await createAdapterPage(page, { nativeNavigationForSetup: true });
  await adapter.goto("http://pw-lite.test/one");
  await adapter.localStorage.setItem("key", "value");
  await expect((adapter as any).missingBrowserOperation()).rejects.toThrow("is not a function");
  await adapter.goto("http://pw-lite.test/two");
  expect(await adapter.localStorage.getItem("key")).toBe("value");
  const entered = await page.evaluate(() => (window as any).__pwLiteEvidence.entered);
  expect(entered.filter((method: string) => method === "Page.localStorage.setItem")).toEqual([
    "Page.localStorage.setItem",
  ]);
  expect(entered).toContain("Page.localStorage.getItem");
  expect((page as any).__pwLiteTransportFailures).toHaveLength(1);
  expect((page as any).__pwLiteNativeOperations).toEqual(["Page.goto", "Page.goto"]);

  // Even with native setup enabled, a missing subject method must fail.
  await page.evaluate(() => {
    (window as any).__pwLiteAdapterPage.localStorage.getItem = undefined;
  });
  await expect(adapter.localStorage.getItem("key")).rejects.toThrow("is not a function");
  expect((page as any).__pwLiteNativeOperations).toEqual(["Page.goto", "Page.goto"]);
  expect((page as any).__pwLiteTransportFailures).toHaveLength(2);
});

test("highlight validates its style like stock Playwright before rendering", async ({ page, adapterPage }) => {
  for (const candidate of [page, adapterPage]) {
    for (const style of [123, true]) {
      await expect(candidate.locator("button").highlight({ style } as never)).rejects.toThrow(
        "style: expected string"
      );
    }
  }
});
