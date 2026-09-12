import {
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { test as pageTest } from "../upstream/pageTest";
import { createAdapterPage } from "../upstream/adapter-bridge";

export { expect } from "../upstream/pageTest";

type ContextRecord = {
  context: BrowserContext;
  pages: Page[];
  captured: Set<Page>;
};
type Evidence = { entered: string[]; failures: string[]; native: string[] };
const contexts = new WeakMap<TestInfo, ContextRecord[]>();
const evidence = new WeakMap<TestInfo, Evidence>();

async function capture(record: ContextRecord, result: Evidence) {
  for (const page of record.pages) {
    if (record.captured.has(page)) continue;
    record.captured.add(page);
    try {
      const observed = await page.evaluate(
        () => (window as any).__pwLiteEvidence
      );
      if (!observed || !Array.isArray(observed.entered))
        throw new Error("Adapter execution evidence is unavailable");
      result.entered.push(...observed.entered);
      result.failures.push(...(observed.failures ?? []));
    } catch (error) {
      // Missing evidence is a diagnostic failure, never a passing fallback.
      result.failures.push(String(error));
    }
    result.failures.push(...((page as any).__pwLiteTransportFailures ?? []));
    result.native.push(...((page as any).__pwLiteNativeOperations ?? []));
  }
}

/** Infrastructure for unchanged library specs that create their own pages.
 * Only declared navigation setup is native and recorded. The methods under
 * test and all their assertions still execute through the browser adapter.
 */
export const browserTest = pageTest.extend<{ _libraryEvidence: void }>({
  server: async ({ server, asset }, use) => {
    server.serveFile("/input/button.html", asset("input/button.html"));
    server.setRoute("/input/mouse-helper.js", (req, res) => {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      server.serveFile(req, res, asset("input/mouse-helper.js"));
    });
    await use(server);
  },
  browser: [
    async ({ browser }, use) => {
      await use(
        new Proxy(browser, {
          get(target, prop) {
            if (prop === "then" || typeof prop === "symbol") return undefined;
            if (prop !== "newContext")
              throw new TypeError(
                `Unsupported library fixture Browser.${prop}`
              );
            return async (...args: Parameters<typeof browser.newContext>) => {
              const info = base.info();
              const result = evidence.get(info)!;
              const context = await target.newContext(...args);
              const record: ContextRecord = {
                context,
                pages: [],
                captured: new Set(),
              };
              contexts.get(info)!.push(record);
              result.native.push("Browser.newContext");
              return new Proxy(context, {
                get(nativeContext, member) {
                  if (member === "then" || typeof member === "symbol")
                    return undefined;
                  if (member === "newPage") {
                    return async () => {
                      const page = await nativeContext.newPage();
                      record.pages.push(page);
                      result.native.push("BrowserContext.newPage");
                      return createAdapterPage(page, {
                        nativeNavigationForSetup: true,
                        underTest: true,
                      });
                    };
                  }
                  if (member === "close") {
                    return async (
                      ...closeArgs: Parameters<typeof context.close>
                    ) => {
                      await capture(record, result);
                      result.native.push("BrowserContext.close");
                      await nativeContext.close(...closeArgs);
                    };
                  }
                  throw new TypeError(
                    `Unsupported library fixture BrowserContext.${member}`
                  );
                },
              });
            };
          },
        })
      );
    },
    { scope: "worker" },
  ],
  _libraryEvidence: [
    async ({}, use, info) => {
      const records: ContextRecord[] = [];
      const result: Evidence = { entered: [], failures: [], native: [] };
      contexts.set(info, records);
      evidence.set(info, result);
      try {
        await use();
      } finally {
        try {
          for (const record of records) {
            await capture(record, result);
            await record.context.close();
          }
        } finally {
          info.annotations.push({
            type: "adapter-execution",
            description: JSON.stringify(result),
          });
          contexts.delete(info);
          evidence.delete(info);
        }
      }
    },
    { auto: true },
  ],
});
