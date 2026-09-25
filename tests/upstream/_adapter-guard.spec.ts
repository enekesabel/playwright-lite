/**
 * Guard tests that verify the fixture routes compatibility calls
 * through the PlaywrightLite in-browser adapter, not the real Playwright driver.
 *
 * These tests would fail if the proxy was accidentally removed and
 * the real Playwright page/locator was passed through instead.
 *
 * Native calls are allowed only for ledger-declared out-of-scope members;
 * all other adapter proxy operations are tested through the browser runtime.
 */
import {
  errors as playwrightErrors,
  test as base,
  expect,
} from "@playwright/test";
import { createAdapterPage } from "./adapter-bridge";
import { test as corpusTest, expect as corpusExpect } from "./pageTest";
import { TestServer } from "./testServer";

// The promotion rerun withholds its method through the generated configuration
// it runs with, which carries the name as a literal. No part of the harness
// reads it from the environment, so a spec may assign anything here and the
// test below still drives the corpus fixture through a working click.
process.env.PW_LITE_SABOTAGE_METHOD = "Locator.click";

type AdapterTimeoutFixtures = {
  actionTimeout: number | undefined;
  navigationTimeout: number | undefined;
};

const test = base.extend<
  { adapterPage: import("@playwright/test").Page } & AdapterTimeoutFixtures
>({
  actionTimeout: [undefined, { option: true, box: true }],
  navigationTimeout: [undefined, { option: true, box: true }],
  adapterPage: async ({ page, actionTimeout, navigationTimeout }, use) => {
    const proxy = await createAdapterPage(page, {
      actionTimeout,
      navigationTimeout,
    });
    await use(proxy);
  },
});

// ── Public expect trust root ────────────────────────────────────────

test("corpus expect enters playwright-lite public matchers for adapter receivers", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<title>Public expect</title><h1>hello</h1>");

  await corpusExpect(adapterPage.locator("h1")).toHaveText("hello");
  await corpusExpect(adapterPage).toHaveTitle("Public expect");
  corpusExpect({ value: 42 }).toEqual({ value: 42 });

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.expect).toEqual(
    expect.arrayContaining(["Locator.toHaveText", "Page.toHaveTitle"])
  );
  expect(execution.entered).toEqual(
    expect.arrayContaining(["Locator._expect", "Page._expect"])
  );
  expect(execution.expectPaths).toEqual(
    expect.arrayContaining([
      { matcher: "Locator.toHaveText", method: "Locator._expect" },
      { matcher: "Page.toHaveTitle", method: "Page._expect" },
    ])
  );
});

test("corpus expect preserves Playwright Test soft assertions", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<h1>hello</h1>");

  await corpusExpect.soft(adapterPage.locator("h1")).toHaveText("hello");
  await corpusExpect
    .configure({ soft: true, timeout: 100 })
    (adapterPage.locator("h1"))
    .toHaveText("hello");

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator._expect");
  expect(
    execution.expect.filter(
      (name: string) => name === "Locator.toHaveText"
    )
  ).toHaveLength(2);
});

test("failing soft adapter assertions keep the public matcher error", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<title>hello</title><h1>hello</h1>");

  await corpusExpect.soft(adapterPage.locator("h1")).toHaveText("goodbye");
  await corpusExpect.soft(adapterPage).toHaveTitle("goodbye");

  const messages = test.info().errors.map((error) => error.message ?? "");
  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  const preserved =
    messages.some((message) =>
      message.includes("expect(locator).toHaveText(expected) failed")
    ) &&
    messages.some((message) =>
      message.includes("expect(page).toHaveTitle(expected) failed")
    ) &&
    messages.every((message) => !message.includes("resolves")) &&
    execution.expectPaths.some(
      (path: { matcher: string; method: string }) =>
        path.matcher === "Locator.toHaveText" &&
        path.method === "Locator._expect"
    ) &&
    execution.expectPaths.some(
      (path: { matcher: string; method: string }) =>
        path.matcher === "Page.toHaveTitle" && path.method === "Page._expect"
    );

  if (!preserved)
    throw new Error(
      `Soft public-expect failure was not preserved: ${JSON.stringify(messages)}`
    );
  test.fail();
});

test("extended corpus matchers stay on the generic expectation surface", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<h1>hello</h1>");
  let calls = 0;
  const extended = corpusExpect.extend({
    toBeAdapterReceiver(received: unknown) {
      calls++;
      return {
        pass: (received as { __pwLiteAdapter?: boolean }).__pwLiteAdapter === true,
        message: () => "expected adapter receiver",
      };
    },
  });

  extended(adapterPage.locator("h1")).toBeAdapterReceiver();
  extended.configure({ timeout: 17 })(adapterPage).toBeAdapterReceiver();
  extended.soft(adapterPage.locator("h1")).toBeAdapterReceiver();
  expect(calls).toBe(3);

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.expect).not.toContain("Locator.toBeAdapterReceiver");
});

test("public matcher sabotage breaks the promoted expect path", async ({ page }) => {
  const sabotaged = await createAdapterPage(page, {
    sabotagedMatcher: "Locator.toHaveText",
  });
  await page.setContent("<h1>hello</h1>");

  await expect(
    corpusExpect(sabotaged.locator("h1")).toHaveText("hello")
  ).rejects.toThrow("__pwLiteSabotagedMatcher: Locator.toHaveText");
});

// A test may catch the assertion error and read its `matcherResult` instead of
// its message. Whatever text it reads there must still say the matcher was
// withheld, so the promotion rerun can tell that failure from any other.
test("a sabotaged matcher's matcherResult carries only the withheld marker", async ({
  page,
}) => {
  const sabotaged = await createAdapterPage(page, {
    sabotagedMatcher: "Locator.toHaveText",
  });
  await page.setContent("<h1>hello</h1>");
  const withheld =
    "__pwLiteSabotagedMatcher: Locator.toHaveText was withheld for promotion review.";

  const error = await corpusExpect(sabotaged.locator("h1"))
    .toHaveText("nope", { timeout: 1 })
    .catch((e) => e);
  expect(error.message).toBe(withheld);
  expect(error.matcherResult).toEqual({
    message: withheld,
    ariaSnapshot: withheld,
    log: [withheld],
  });

  // Every other matcher still reports the adapter's own result.
  const other = await corpusExpect(sabotaged.locator("h1"))
    .toHaveCount(2, { timeout: 1 })
    .catch((e) => e);
  expect(other.matcherResult).toMatchObject({
    name: "toHaveCount",
    pass: false,
    actual: 1,
    expected: 2,
  });
  expect(JSON.stringify(other.matcherResult)).not.toContain(
    "__pwLiteSabotagedMatcher"
  );
});

// ── Proxy presence ──────────────────────────────────────────────────

for (const owner of ["Page", "Locator"] as const) {
  test(`${owner}.setInputFiles transports bytes but executes in the browser`, async ({ page, adapterPage }) => {
    await page.setContent('<input type="file">');
    const nativeSetInputFiles = page.setInputFiles;
    const nativeLocator = page.locator;
    page.setInputFiles = async () => { throw new Error("native upload must not run"); };
    page.locator = () => { throw new Error("native locator must not run"); };
    try {
      const payload = {
        name: "bytes.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.from([99, 0, 128, 255, 99]).subarray(1, 4),
      };
      if (owner === "Page") await adapterPage.setInputFiles("input", payload);
      else await adapterPage.locator("input").setInputFiles(payload);
      expect(await page.evaluate(async () => {
        const file = document.querySelector("input")!.files![0];
        return { name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) };
      })).toEqual({ name: "bytes.bin", bytes: [0, 128, 255] });
      expect((page as any).__pwLiteNativeOperations).toEqual([]);
    } finally {
      page.setInputFiles = nativeSetInputFiles;
      page.locator = nativeLocator;
    }
  });
}

test("all preserves the actual runtime-returned locators", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<p>first</p><p>second</p>");
  await page.evaluate(() => {
    const runtime = (window as any).__pwLiteAdapterPage;
    const locator = runtime.locator.bind(runtime);
    runtime.locator = (...args: unknown[]) => {
      const result = locator(...args);
      result.all = async () => [locator("p").nth(1), locator("p").nth(0)];
      return result;
    };
  });
  const results = await adapterPage.locator("p").all();
  expect(await results[0].textContent()).toBe("second");
  expect(await results[1].textContent()).toBe("first");
  await adapterPage.evaluate(() => {
    document.querySelectorAll("p")[1].textContent = "changed";
  });
  expect(await results[0].textContent()).toBe("changed");
  expect(await results[0].locator("..").count()).toBe(1);
});

test("waitForFunction invokes the public runtime and preserves its handle", async ({
  page,
  adapterPage,
}) => {
  await page.evaluate(() => {
    const host = window as any;
    host.__pwLiteAdapterPage.waitForFunction = async (
      callback: () => unknown
    ) => {
      host.handleDisposed = false;
      let reads = 0;
      return {
        jsonValue: async () => ({ value: callback(), reads: ++reads }),
        dispose: async () => {
          host.handleDisposed = true;
        },
      };
    };
  });
  const handle = await adapterPage.waitForFunction(() => "browser callback");
  expect(await handle.jsonValue()).toEqual({
    value: "browser callback",
    reads: 1,
  });
  expect(await handle.jsonValue()).toEqual({
    value: "browser callback",
    reads: 2,
  });
  await handle.dispose();
  expect(await page.evaluate(() => (window as any).handleDisposed)).toBe(true);
  await expect(handle.jsonValue()).rejects.toThrow("Unknown or disposed");
});

test("execution evidence records browser method entry and swallowed dispatch failures", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<button>hello</button>");
  await adapterPage.locator("button").count();
  await adapterPage.pickLocator().catch(() => {});
  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator.count");
  expect(execution.entered).not.toContain("Page.pickLocator");
  expect((page as any).__pwLiteTransportFailures.length).toBeGreaterThan(0);
});

// ── Transport failure classification ────────────────────────────────
// A transport failure means the bridge could not carry a call, never that the
// adapter or the page code it ran threw. The two can share a message, so the
// classification cannot come from the message.

test("an error the page code or the adapter raises is not a transport failure", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<button>hello</button>");
  const raised: [string, () => Promise<unknown>, string][] = [
    [
      "page code calling a missing function",
      () => adapterPage.evaluate(() => (window as any).missing()),
      "missing is not a function",
    ],
    [
      "page code throwing a serialization message",
      () =>
        adapterPage.evaluate(() => {
          throw new Error("could not serialize the value");
        }),
      "could not serialize the value",
    ],
    [
      "page code throwing an execution context message",
      () =>
        adapterPage.evaluate(() => {
          throw new Error(
            "Execution context was destroyed, most likely because of a navigation."
          );
        }),
      "Execution context was destroyed",
    ],
    [
      "page code throwing a closed target message",
      () =>
        adapterPage.evaluate(() => {
          throw new Error("Target page, context or browser has been closed");
        }),
      "Target page, context or browser has been closed",
    ],
    [
      "a locator callback calling a missing function",
      () =>
        adapterPage
          .locator("button")
          .evaluate(() => (window as any).missing()),
      "missing is not a function",
    ],
    [
      "a waitForFunction predicate calling a missing function",
      () => adapterPage.waitForFunction(() => (window as any).missing()),
      "missing is not a function",
    ],
    [
      "the adapter refusing a function argument, as Playwright does",
      () => adapterPage.evaluate((value) => value, { f() {} } as never),
      "Attempting to serialize unexpected value",
    ],
  ];
  for (const [label, run, message] of raised)
    await expect(run(), label).rejects.toThrow(message);
  expect((page as any).__pwLiteTransportFailures).toEqual([]);
});

test("classifying an adapter rejection leaves unhandled-rejection reporting as it was", async ({
  page,
  adapterPage,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // The bridge awaits the adapter call, so its rejection is handled.
  await expect(
    adapterPage.evaluate(() => (window as any).awaitedMissing())
  ).rejects.toThrow("awaitedMissing is not a function");
  // Page code that leaves an adapter call unawaited still gets an unhandled
  // rejection, which the browser reports as a page error.
  await page.evaluate(() => {
    void (window as any).__pwLiteAdapterPage.evaluate(() =>
      (window as any).floatingMissing()
    );
  });
  await expect
    .poll(() => pageErrors.some((message) => message.includes("floatingMissing")))
    .toBe(true);
  expect(
    pageErrors.filter((message) => message.includes("awaitedMissing"))
  ).toEqual([]);
});

test("calling a disposed exposed function is a page error, not a transport failure", async ({
  page,
  adapterPage,
}) => {
  const binding = await adapterPage.exposeFunction(
    "compute",
    (a: number, b: number) => a * b
  );
  await expect(
    adapterPage.evaluate(() => (window as any).compute(9, 4))
  ).resolves.toBe(36);
  await binding.dispose();
  await expect(
    adapterPage.evaluate(() => (window as any).compute(9, 4))
  ).rejects.toThrow("window.compute is not a function");
  expect((page as any).__pwLiteTransportFailures).toEqual([]);
});

test("an error a network object's member raises is not a transport failure", async ({
  page,
}) => {
  await page.route("http://pw-lite.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>ok</p>" })
  );
  await page.goto("http://pw-lite.test/");
  const adapter = await createAdapterPage(page);
  const [request] = await Promise.all([
    adapter.waitForRequest("**/data"),
    adapter.evaluate(() => {
      void fetch("/data");
    }),
  ]);
  await page.evaluate(() => {
    for (const object of (window as any).__pwLiteNetworkObjects.values())
      object.response = async () => (window as any).missing();
  });
  await expect(request.response()).rejects.toThrow(
    "missing is not a function"
  );
  expect((page as any).__pwLiteTransportFailures).toEqual([]);
});

test("a call the bridge dispatches to a missing adapter member is a transport failure", async ({
  page,
  adapterPage,
}) => {
  await expect((adapterPage as any).missingBrowserOperation()).rejects.toThrow(
    "__pwLiteAdapterPage.missingBrowserOperation is not a function"
  );
  expect((page as any).__pwLiteTransportFailures).toEqual([
    expect.stringContaining(
      "__pwLiteAdapterPage.missingBrowserOperation is not a function"
    ),
  ]);
});

test("a transport failure is recorded while the browser is still being asked about it", async ({
  page,
  adapterPage,
}) => {
  // Hold the browser's answer back, as a call nothing awaits would see it
  // when the fixture reads the evidence at teardown.
  await page.evaluate(() => {
    const host = window as any;
    const claim = host.__pwLiteClaimAdapterError;
    host.__pwLiteClaimAdapterError = (line: string) => {
      const until = Date.now() + 500;
      while (Date.now() < until);
      return claim(line);
    };
  });
  let settled = false;
  const call = (adapterPage as any)
    .missingBrowserOperation()
    .catch(() => (settled = true));
  await expect
    .poll(() => (page as any).__pwLiteTransportFailures.length)
    .toBe(1);
  expect(settled).toBe(false);
  await call;
  expect((page as any).__pwLiteTransportFailures).toEqual([
    expect.stringContaining(
      "__pwLiteAdapterPage.missingBrowserOperation is not a function"
    ),
  ]);
});

test("a missing bridge member is a transport failure", async ({
  page,
  adapterPage,
}) => {
  await page.evaluate(() => {
    delete (window as any).__pwLiteInvokeAdapter;
  });
  await expect(adapterPage.evaluate(() => 1)).rejects.toThrow(
    "is not a function"
  );
  expect((page as any).__pwLiteTransportFailures).toEqual([
    expect.stringContaining("__pwLiteInvokeAdapter is not a function"),
  ]);
});

test("a value the transport cannot serialize is a transport failure", async ({
  page,
  // Creating the adapter page makes this page's evaluate the bridge transport.
  adapterPage: _adapterPage,
}) => {
  await expect(
    page.evaluate((value) => value, { f() {} } as never)
  ).rejects.toThrow("Attempting to serialize unexpected value");
  expect((page as any).__pwLiteTransportFailures).toEqual([
    expect.stringContaining("Attempting to serialize unexpected value"),
  ]);
});

test("a destroyed execution context is a transport failure even when page code caused it", async ({
  page,
  adapterPage,
}) => {
  await expect(
    adapterPage.evaluate(() => {
      setTimeout(() => location.reload());
      return new Promise(() => {});
    })
  ).rejects.toThrow("Execution context was destroyed");
  expect((page as any).__pwLiteTransportFailures).toEqual([
    expect.stringContaining("Execution context was destroyed"),
  ]);
});

test("a closed target is a transport failure", async ({
  page,
  adapterPage,
}) => {
  await page.close();
  await expect(adapterPage.evaluate(() => 1)).rejects.toThrow(
    "Target page, context or browser has been closed"
  );
  expect((page as any).__pwLiteTransportFailures).toEqual([
    expect.stringContaining("Target page, context or browser has been closed"),
  ]);
});

corpusTest(
  "a spec setting the promotion switch does not sabotage the corpus fixture",
  async ({ page }) => {
    await page.setContent(
      '<button onclick="window.clicked = true">hello</button>'
    );
    await page.locator("button").click();
    expect(await page.evaluate(() => (window as any).clicked)).toBe(true);
  }
);

// Only the promotion rerun sets this option; every other test here shows the
// unsabotaged default, where each recorded method executes normally.
test("a sabotaged method throws where it is recorded and leaves the rest working", async ({
  page,
}) => {
  const sabotaged = await createAdapterPage(page, {
    sabotagedMethod: "Locator.click",
  });
  await page.setContent(
    '<button onclick="window.clicked = true">hello</button>'
  );
  await expect(sabotaged.locator("button").click()).rejects.toThrow(
    "Locator.click was withheld"
  );
  expect(await page.evaluate(() => (window as any).clicked)).toBe(undefined);
  expect(await sabotaged.locator("button").textContent()).toBe("hello");
});

test("explicit out-of-scope Page methods use native operations without adapter evidence", async ({
  page,
  adapterPage,
}) => {
  await adapterPage.setContent("<p>native setup</p>");
  await adapterPage.setViewportSize({ width: 320, height: 240 });

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).not.toContain("Page.setContent");
  expect(execution.entered).not.toContain("Page.setViewportSize");
  expect((page as any).__pwLiteNativeOperations).toEqual([
    "Page.setContent",
    "Page.setViewportSize",
  ]);
  await expect(adapterPage.locator("p").textContent()).resolves.toBe(
    "native setup"
  );
});

test("explicit out-of-scope Locator iframe methods stay native downstream", async ({
  page,
  adapterPage,
}) => {
  await page.setContent(
    '<iframe name="nested" srcdoc="<p>native iframe</p>"></iframe>'
  );

  const iframe = adapterPage.locator("iframe");
  const contentFrame = iframe.contentFrame();
  await expect(contentFrame.locator("p").textContent()).resolves.toBe(
    "native iframe"
  );
  await expect(
    adapterPage
      .locator("body")
      .frameLocator("iframe")
      .locator("p")
      .textContent()
  ).resolves.toBe("native iframe");
  await expect(
    adapterPage.frameLocator("iframe").locator("p").textContent()
  ).resolves.toBe("native iframe");
  expect(adapterPage.frames()).toHaveLength(2);
  await expect(
    adapterPage.frame({ name: "nested" })?.locator("p").textContent()
  ).resolves.toBe("native iframe");

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).not.toContain("Locator.contentFrame");
  expect(execution.entered).not.toContain("Locator.frameLocator");
  expect(execution.entered).not.toContain("Page.frameLocator");
  expect(execution.entered).not.toContain("Page.frames");
  expect(execution.entered).not.toContain("Page.frame");
  expect((page as any).__pwLiteNativeOperations).toEqual(
    expect.arrayContaining([
      "Locator.contentFrame",
      "Locator.frameLocator",
      "Page.frameLocator",
      "Page.frames",
      "Page.frame",
      "Locator.textContent",
    ])
  );
});

test("Locator.all() retains a native counterpart for explicit out-of-scope calls", async ({
  page,
  adapterPage,
}) => {
  await page.setContent('<iframe srcdoc="<p>all result</p>"></iframe>');

  const [iframe] = await adapterPage.locator("iframe").all();
  await expect(iframe.contentFrame().locator("p").textContent()).resolves.toBe(
    "all result"
  );
  await expect(
    iframe
      .first()
      .describe("iframe from all")
      .contentFrame()
      .locator("p")
      .textContent()
  ).resolves.toBe("all result");
  await expect(
    adapterPage
      .locator("iframe")
      .last()
      .contentFrame()
      .locator("p")
      .textContent()
  ).resolves.toBe("all result");

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator.all");
  expect(execution.entered).not.toContain("Locator.contentFrame");
  expect((page as any).__pwLiteNativeOperations).toEqual(
    expect.arrayContaining(["Locator.contentFrame", "Locator.textContent"])
  );
});

test("page fixture is the adapter proxy", async ({ adapterPage }) => {
  expect((adapterPage as any).__pwLiteAdapter).toBe(true);
});

test("page.locator returns an adapter proxy locator", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<div></div>");
  const locator = adapterPage.locator("div");
  expect((locator as any).__pwLiteAdapter).toBe(true);
});

test("page.mainFrame keeps the single-document adapter facade", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<main><p>hello</p></main>");

  const mainFrame = adapterPage.mainFrame();
  expect((mainFrame as any).__pwLiteAdapter).toBe(true);
  await expect(mainFrame.locator("p").textContent()).resolves.toBe("hello");
});

test("page.url preserves Playwright's synchronous call shape", async ({
  page,
  adapterPage,
}) => {
  const url = adapterPage.url();

  expect(url).toBe(page.url());
  expect(url).not.toBeInstanceOf(Promise);

  await adapterPage.evaluate(() => (window.location.hash = "adapter"));
  expect(adapterPage.url()).toBe(page.url());
});

test("interval waitForFunction uses the controlled Date and settles", async ({
  page,
  adapterPage,
}) => {
  const handle = await adapterPage.waitForFunction(
    () => {
      window["__adapterWaitForFunctionCalls"] =
        (window["__adapterWaitForFunctionCalls"] || 0) + 1;
      const calls = window["__adapterWaitForFunctionCalls"];
      return window.builtins.Date.now() && calls >= 2 ? calls : false;
    },
    {},
    { polling: 1 }
  );
  const settledCalls = await handle.jsonValue();

  await page.waitForTimeout(20);
  expect(
    await page.evaluate(() => window["__adapterWaitForFunctionCalls"])
  ).toBe(settledCalls);
});

test("window.builtins keeps the page's own timers and performance", async ({
  adapterPage,
}) => {
  const observed = await adapterPage.evaluate(async () => {
    const replaced = () => {
      throw new Error("replaced timer must not run");
    };
    const realTimers = {
      setTimeout: window.setTimeout,
      setInterval: window.setInterval,
      requestAnimationFrame: window.requestAnimationFrame,
    };
    const realPerformance = window.performance;
    // Upstream's builtins protect a spec from a page that replaces its
    // timers, so this guard replaces them the way clock emulation would.
    Object.assign(window, {
      setTimeout: replaced,
      setInterval: replaced,
      requestAnimationFrame: replaced,
    });
    Object.defineProperty(window, "performance", {
      configurable: true,
      value: { mark: replaced, measure: replaced, getEntriesByType: replaced },
    });
    try {
      const builtins = window.builtins;
      const timeout = await new Promise((resolve) => {
        builtins.clearTimeout(
          builtins.setTimeout(() => resolve("cleared timeout ran"), 1)
        );
        builtins.setTimeout(() => resolve("timeout"), 2);
      });
      const interval = await new Promise((resolve) => {
        let ticks = 0;
        const id = builtins.setInterval(() => {
          if (++ticks < 2) return;
          builtins.clearInterval(id);
          resolve("interval");
        }, 1);
      });
      const frame = await new Promise((resolve) => {
        builtins.cancelAnimationFrame(
          builtins.requestAnimationFrame(() => resolve("cancelled frame ran"))
        );
        builtins.requestAnimationFrame(() => resolve("frame"));
      });
      builtins.performance.mark("guard-start");
      builtins.performance.mark("guard-end");
      builtins.performance.measure("guard", "guard-start", "guard-end");
      return {
        members: Object.keys(builtins).sort(),
        timeout,
        interval,
        frame,
        measures: builtins.performance
          .getEntriesByType("measure")
          .map((entry) => entry.name),
        date: typeof builtins.Date.now(),
      };
    } finally {
      Object.assign(window, realTimers);
      Object.defineProperty(window, "performance", {
        configurable: true,
        value: realPerformance,
      });
    }
  });

  expect(observed).toEqual({
    members: [
      "AbortSignal",
      "Date",
      "Intl",
      "cancelAnimationFrame",
      "cancelIdleCallback",
      "clearInterval",
      "clearTimeout",
      "performance",
      "requestAnimationFrame",
      "requestIdleCallback",
      "setInterval",
      "setTimeout",
    ],
    timeout: "timeout",
    interval: "interval",
    frame: "frame",
    measures: ["guard"],
    date: "number",
  });
});

// ── Adapter routing works ───────────────────────────────────────────

test("adapter goto keeps hash navigation in the current document", async ({
  page,
  adapterPage,
}) => {
  await page.setContent('<p id="section">retained</p>');
  const element = await adapterPage.$("p");
  for (const waitUntil of ["commit", "domcontentloaded", "load"] as const) {
    await expect(
      adapterPage.goto(`#${waitUntil}`, { waitUntil })
    ).resolves.toBeNull();
    expect(adapterPage.url()).toBe(`about:blank#${waitUntil}`);
    expect(await element!.textContent()).toBe("retained");
  }
  // Assigning the existing fragment does not emit another hashchange.
  await expect(adapterPage.goto("#load")).resolves.toBeNull();
  expect(
    await page.evaluate(() => (window as any).__pwLiteEvidence.entered)
  ).toContain("Page.goto");
});

for (const reload of [false, true]) {
  test(`adapter goto ${reload ? "reloads the same URL" : "replaces the document"} without resuming execution`, async ({
    page,
  }) => {
    const server = await TestServer.create();
    try {
      if (reload) await page.goto(server.EMPTY_PAGE);
      const adapterPage = await createAdapterPage(page);
      await page.evaluate(() => {
        window.name = "old execution";
      });
      const arrived = page.waitForURL(server.EMPTY_PAGE, { waitUntil: "load" });
      // Use a navigation event for same-URL reload: waitForURL may already match.
      const navigated = page.waitForEvent(
        "framenavigated",
        (frame) => frame === page.mainFrame()
      );
      const navigation = reload
        ? page.evaluate(async (url) => {
            await (window as any).__pwLiteAdapterPage.goto(url);
            window.name = "incorrectly resumed";
          }, server.EMPTY_PAGE)
        : adapterPage.goto(server.EMPTY_PAGE);
      const result = navigation.then(
        () => "resolved",
        (error) => String(error)
      );
      await navigated;
      await arrived;
      expect(await result).toMatch(/execution context.*destroyed/i);
      expect(await page.evaluate(() => window.name)).toBe("old execution");
      expect(
        await page.evaluate(() => typeof (window as any).__pwLiteAdapterPage.goto)
      ).toBe("function");
    } finally {
      await server.close();
    }
  });
}

test("adapter waitForURL does not resume across document replacement", async ({
  page,
  adapterPage,
}) => {
  const server = await TestServer.create();
  try {
    const arrived = page.waitForURL(server.EMPTY_PAGE, { waitUntil: "load" });
    const waiting = adapterPage
      .waitForURL(server.EMPTY_PAGE, { waitUntil: "load" })
      .then(
        () => "resolved",
        (error) => String(error)
      );
    const navigation = adapterPage.goto(server.EMPTY_PAGE).then(
      () => "resolved",
      (error) => String(error)
    );

    await arrived;
    expect(await waiting).toMatch(/execution context.*destroyed/i);
    expect(await navigation).toMatch(/execution context.*destroyed/i);
  } finally {
    await server.close();
  }
});

test("adapter waitForNavigation never reports a document replacement", async ({
  page,
  adapterPage,
}) => {
  const server = await TestServer.create();
  try {
    const arrived = page.waitForURL(server.EMPTY_PAGE, { waitUntil: "load" });
    const waiting = adapterPage.waitForNavigation().then(
      (response) => `resolved with ${response}`,
      (error) => String(error)
    );
    await page.evaluate((url) => {
      window.location.href = url;
    }, server.EMPTY_PAGE);

    await arrived;
    expect(await waiting).toMatch(/execution context.*destroyed/i);
  } finally {
    await server.close();
  }
});

test("adapter waitForNavigation times out on a navigation that keeps the document", async ({
  page,
  adapterPage,
}) => {
  const server = await TestServer.create();
  try {
    server.setRoute("/no-content", (_request, response) => {
      response.statusCode = 204;
      response.end();
    });
    await page.goto(server.EMPTY_PAGE);
    await page.evaluate(() => {
      (window as any).marker = "kept";
    });
    const waiting = adapterPage
      .waitForNavigation({ timeout: 1000 })
      .catch((error) => String(error));
    const requested = server.waitForRequest("/no-content");
    await page.evaluate((url) => {
      window.location.href = url;
    }, server.PREFIX + "/no-content");
    await requested;

    expect(await waiting).toContain(
      "page.waitForNavigation: Timeout 1000ms exceeded."
    );
    expect(await page.evaluate(() => (window as any).marker)).toBe("kept");
  } finally {
    await server.close();
  }
});

test("adapter goto rejects unsupported options before changing the URL", async ({
  page,
  adapterPage,
}) => {
  const before = page.url();
  await expect(
    adapterPage.goto("#changed", { referer: "https://example.com" })
  ).rejects.toThrow(/referer/);
  await expect(adapterPage.goto("#changed", { timeout: -1 })).rejects.toThrow(
    /Timeout/
  );
  await expect(
    adapterPage.goto("javascript:window.name='changed'")
  ).rejects.toThrow(/protocol/);
  expect(page.url()).toBe(before);
});

test("adapter goto times out when native navigation leaves the document in place", async ({
  page,
}) => {
  const server = await TestServer.create();
  server.setRoute("/no-content", (_request, response) => {
    response.writeHead(204);
    response.end();
  });
  try {
    await page.goto(server.EMPTY_PAGE);
    const adapterPage = await createAdapterPage(page);
    // Setter transport is asynchronous even though the production setter is synchronous.
    await (adapterPage as any).setDefaultNavigationTimeout(50);
    const error = await adapterPage
      .goto(`${server.PREFIX}/no-content`)
      .catch((error) => error);
    expect(error).toBeInstanceOf(playwrightErrors.TimeoutError);
    expect(error.message).toContain("page.goto: Timeout 50ms exceeded");
    expect(error.message).toContain(`${server.PREFIX}/no-content`);
    expect(page.url()).toBe(server.EMPTY_PAGE);
  } finally {
    await server.close();
  }
});

test("adapter locator.click reaches the DOM", async ({ page, adapterPage }) => {
  await page.setContent(`
    <button>Click me</button>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.title = 'adapter-click';
      });
    </script>
  `);

  await adapterPage.locator("button").click();

  const title = await page.evaluate(() => document.title);
  expect(title).toBe("adapter-click");
});

test("adapter locator descriptions share runtime formatting", async ({
  adapterPage,
}) => {
  const locator = adapterPage.getByRole("button", { name: "Save" });

  expect(locator.description()).toBeNull();
  expect(locator.toString()).toBe("getByRole('button', { name: 'Save' })");
  expect(locator.describe("Save button").description()).toBe("Save button");
  expect(locator.describe("Save button").toString()).toBe("Save button");
  expect(locator.describe("").description()).toBe("");
});

test("adapter locator.fill reaches the DOM", async ({ page, adapterPage }) => {
  await page.setContent(`<input type="text" />`);

  await adapterPage.locator("input").fill("hello");

  const value = await page.evaluate(
    () => (document.querySelector("input") as HTMLInputElement).value
  );
  expect(value).toBe("hello");
});

test("adapter locator.count works through the bridge", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<ul><li>A</li><li>B</li><li>C</li></ul>");
  const count = await adapterPage.locator("li").count();
  expect(count).toBe(3);
});

test("adapter locator composition reconstructs nested proxy locators", async ({
  page,
  adapterPage,
}) => {
  await page.setContent(`
    <button class=primary>Save</button>
    <button>Cancel</button>
    <a class=primary>Save link</a>
  `);
  const buttons = adapterPage.getByRole("button");
  const primary = adapterPage.locator(".primary");

  await expect(buttons.and(primary).allTextContents()).resolves.toEqual([
    "Save",
  ]);
  await expect(buttons.or(primary).allTextContents()).resolves.toEqual([
    "Save",
    "Cancel",
    "Save link",
  ]);
  await expect(
    adapterPage.locator("button").filter({ has: primary }).count()
  ).resolves.toBe(0);

  // Locator composition needs recursive proxy reconstruction, but evaluation
  // arguments must follow Playwright serialization rather than transport Locators.
  await expect(
    page.evaluate(value => value, { locators: [page.getByRole("button")] })
  ).rejects.toThrow();
  await expect(
    adapterPage.evaluate(value => value, { locators: [buttons] })
  ).rejects.toThrow("Attempting to serialize unexpected value");
  await expect(buttons.count()).resolves.toBe(2);

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator.and");
  expect(execution.entered).toContain("Locator.or");
});

test("adapter locator matchers use pinned InjectedScript semantics", async ({
  page,
  adapterPage,
}) => {
  await page.setContent(`
    <p class="message">Hello <strong>adapter</strong></p>
    <p class="message" hidden>Hidden</p>
  `);

  await expect(adapterPage.locator("p.message").first()).toHaveText(
    "Hello adapter"
  );
  await expect(adapterPage.locator("p.message")).toHaveCount(2);
  await expect(adapterPage.locator("p.message").first()).toBeVisible();
  await expect(adapterPage.locator("p.message").last()).toBeHidden();

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator._expect");
});

test("adapter locator matchers retry through the browser adapter", async ({
  page,
  adapterPage,
}) => {
  await page.setContent('<p id="message">before</p>');
  await page.evaluate(() => {
    window.setTimeout(() => {
      document.getElementById("message")!.textContent = "after";
    }, 25);
  });

  await expect(adapterPage.locator("#message")).toHaveText("after", {
    timeout: 1_000,
  });
});

test("adapter callback operations reconstruct in the adapter", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<ul><li>A</li><li>B</li></ul>");

  const one = await adapterPage
    .locator("li")
    .first()
    .evaluate((element, suffix) => element.textContent + suffix, "!");
  const all = await adapterPage
    .locator("li")
    .evaluateAll(
      (elements, payload) =>
        elements.map(
          (element) =>
            payload.prefix +
            element.textContent +
            `:${payload.optional === undefined}:${Number.isNaN(payload.nan)}`
        ),
      { prefix: "item:", optional: undefined, nan: Number.NaN }
    );

  expect(one).toBe("A!");
  expect(all).toEqual(["item:A:true:true", "item:B:true:true"]);
  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator.evaluate");
  expect(execution.entered).toContain("Locator.evaluateAll");
});

test("adapter handle evaluation forwards string expressions unchanged", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<div>handle</div>");
  const handle = await adapterPage.$("div");
  if (!handle) throw new Error("Expected ElementHandle");

  await page.evaluate(() => {
    const host = window as any;
    const resolve = host.__pwLiteElementHandleForId;
    host.__pwLiteElementHandleForId = (id: string) => {
      const target = resolve(id);
      return new Proxy(target, {
        get(target, property, receiver) {
          if (property === "evaluate")
            return async (expression: unknown) => ({
              expression,
              type: typeof expression,
            });
          return Reflect.get(target, property, receiver);
        },
      });
    };
  });

  await expect(handle.evaluate("document.title")).resolves.toEqual({
    expression: "document.title",
    type: "string",
  });
});

test("adapter locator evaluation forwards string expressions unchanged", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<div>locator</div>");
  await page.evaluate(() => {
    const host = window as any;
    const locator = host.__pwLiteAdapterPage.locator.bind(
      host.__pwLiteAdapterPage
    );
    host.__pwLiteAdapterPage.locator = (...args: unknown[]) => {
      const target = locator(...args);
      target.evaluate = async (expression: unknown) => ({
        expression,
        type: typeof expression,
      });
      return target;
    };
  });

  await expect(
    adapterPage.locator("div").evaluate("document.title")
  ).resolves.toEqual({
    expression: "document.title",
    type: "string",
  });
});

test("adapter page callbacks enter public adapter methods", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<p>callback</p>");

  await expect(
    (adapterPage as any).evaluate(
      () => document.querySelector("p")?.textContent
    )
  ).resolves.toBe("callback");
  await expect(
    (adapterPage as any).$eval("p", (element) => element.textContent)
  ).resolves.toBe("callback");
  await expect(
    (adapterPage as any).$$eval("p", (elements) => elements.length)
  ).resolves.toBe(1);

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Page.evaluate");
  expect(execution.entered).toContain("Page.$eval");
  expect(execution.entered).toContain("Page.$$eval");
});

test("method shorthand page functions reach the adapter as the caller wrote them", async ({
  adapterPage,
}) => {
  const shorthand = {
    sum([a, b]: number[]) {
      return a + b;
    },
    async mult([a, b]: number[]) {
      return a * b;
    },
  };

  await expect((adapterPage as any).evaluate(shorthand.sum, [1, 2])).resolves.toBe(3);
  await expect((adapterPage as any).evaluate(shorthand.mult, [2, 4])).resolves.toBe(8);
});

test("rich argument values arrive in the adapter with their own identity", async ({
  page,
  adapterPage,
}) => {
  const error = new Error("error message");
  error.name = "foobar";
  const argument = {
    date: new Date("2020-05-27T01:31:38.506Z"),
    url: new URL("https://example.com/path"),
    regexp: /hello/im,
    error,
    map: new Map([[1, 2]]),
    typed: new Int16Array([1, 2, 3]),
    bytes: Buffer.from([99, 0, 128, 255, 99]).subarray(1, 4),
    poisoned: { __proto__: { polluted: true }, safeKey: "safeValue" },
  };

  await expect(
    (adapterPage as any).evaluate(
      (a: any) => ({
        date: [a.date instanceof Date, a.date.toISOString()],
        url: [a.url instanceof URL, a.url.toString()],
        regexp: [a.regexp instanceof RegExp, a.regexp.toString()],
        error: [a.error instanceof Error, a.error.name, a.error.message],
        map: a.map.constructor.name + " " + JSON.stringify(a.map),
        typed: [a.typed.constructor.name, Array.from(a.typed)],
        bytes: [a.bytes.constructor.name, Array.from(a.bytes)],
        poisoned: [Object.keys(a.poisoned), (a.poisoned as any).polluted],
      }),
      argument
    )
  ).resolves.toEqual({
    date: [true, "2020-05-27T01:31:38.506Z"],
    url: [true, "https://example.com/path"],
    regexp: [true, "/hello/im"],
    error: [true, "foobar", "error message"],
    map: "Object {}",
    typed: ["Int16Array", [1, 2, 3]],
    bytes: ["Uint8Array", [0, 128, 255]],
    poisoned: [["safeKey"], undefined],
  });
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("a live native driver object is still refused as an argument", async ({
  page,
  adapterPage,
}) => {
  await page.setContent('<iframe srcdoc="<p>native iframe</p>"></iframe>');

  await expect(
    (adapterPage as any).evaluate(
      (a: unknown) => a,
      adapterPage.frameLocator("iframe")
    )
  ).rejects.toThrow("does not support native Playwright handles or frames");
});

test("function arguments reach the adapter as functions with their source", async ({
  page,
  adapterPage,
}) => {
  await page.evaluate(() => {
    const host = window as any;
    host.__pwLiteAdapterPage.evaluate = async (callback: any, arg: any) => ({
      callbackSource: String(callback),
      argumentKind: typeof arg.nested.property,
      argumentSource: String(arg.nested.property),
      called: arg.nested.property(),
    });
  });

  await expect(
    (adapterPage as any).evaluate((a: any) => a, {
      nested: { property: () => 41 + 1 },
    })
  ).resolves.toEqual({
    callbackSource: expect.stringContaining("=>"),
    argumentKind: "function",
    argumentSource: expect.stringContaining("41 + 1"),
    called: 42,
  });
  // The unreplaced adapter still applies its own pinned rejection.
  await expect(
    (await createAdapterPage(page)).evaluate((a: unknown) => a, () => {})
  ).rejects.toThrow("Attempting to serialize unexpected value");
});

test("a page.on listener asserts with the adapter's public expect", async ({
  page,
  adapterPage,
}) => {
  const listenerFailures: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("listener failed"))
      listenerFailures.push(message.text());
  });
  const listener = (error: Error) => {
    expect(error.message).toBe("expected");
    (window as any).__pwLiteAssertedMessage = error.message;
  };
  adapterPage.on("pageerror", listener);
  const assertedMessage = () =>
    page.evaluate(() => (window as any).__pwLiteAssertedMessage ?? null);
  const throwInPage = (message: string) =>
    page.evaluate((m) => {
      setTimeout(() => {
        throw new Error(m);
      });
    }, message);

  // The rebuilt listener keeps the caller's source for the adapter.
  await expect(
    page.evaluate(
      (source) =>
        String((window as any).__pwLiteReconstructFunction(source)),
      listener.toString()
    )
  ).resolves.toBe(listener.toString());

  // Passing: the assertion runs and the listener continues past it.
  await throwInPage("expected");
  await expect.poll(assertedMessage).toBe("expected");
  expect(listenerFailures).toEqual([]);

  // Failing: the adapter's matcher throws, so the listener stops before its
  // next statement and the package logs the failure instead of rethrowing it.
  await page.evaluate(() => delete (window as any).__pwLiteAssertedMessage);
  await throwInPage("unexpected");
  await expect.poll(() => listenerFailures.length).toBe(1);
  // ExpectationError is the package's matcher failure, not a ReferenceError
  // for an unbound `expect`.
  expect(listenerFailures[0]).toContain(
    "listener failed ExpectationError: expect(received).toBe(expected)"
  );
  await expect(assertedMessage()).resolves.toBeNull();
});

test("evaluateHandle, getProperty and getProperties republish the adapter's own handles", async ({
  page,
  adapterPage,
}) => {
  await page.evaluate(() => {
    const host = window as any;
    const sentinelHandle = (description: string, value: unknown): unknown => ({
      toString: () => description,
      jsonValue: async () => value,
      getProperty: async (name: string) =>
        sentinelHandle(`property:${name}`, `${name}=${value}`),
      getProperties: async () =>
        new Map([["only", sentinelHandle("property:only", value)]]),
      dispose: async () => {
        host.disposedHandles = [...(host.disposedHandles ?? []), description];
      },
    });
    host.__pwLiteAdapterPage.evaluateHandle = async (
      callback: any,
      arg: unknown
    ) => sentinelHandle("JSHandle@browser", await callback(arg));
  });

  const handle = await (adapterPage as any).evaluateHandle(
    (a: string) => ((window.location.hash = "handle"), a + "!"),
    "sentinel"
  );
  // Handle routes refresh the synchronous url facade like every other member.
  expect(adapterPage.url()).toBe(page.url());
  // toString() is synchronous in Playwright's API: it replays the description
  // the adapter gave when the handle was created.
  expect(handle.toString()).toBe("JSHandle@browser");
  expect(await handle.jsonValue()).toBe("sentinel!");

  const property = await handle.getProperty("only");
  expect(property.toString()).toBe("property:only");
  expect(await property.jsonValue()).toBe("only=sentinel!");

  const properties = await handle.getProperties();
  expect([...properties.keys()]).toEqual(["only"]);
  expect(await properties.get("only").jsonValue()).toBe("sentinel!");

  await property.dispose();
  await handle.dispose();
  expect(await page.evaluate(() => (window as any).disposedHandles)).toEqual([
    "property:only",
    "JSHandle@browser",
  ]);
  await expect(handle.jsonValue()).rejects.toThrow("Unknown or disposed");
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("a member without a dedicated handle route republishes the handle it returned", async ({
  page,
  adapterPage,
}) => {
  const scriptHandle = await (adapterPage as any).addScriptTag({
    content: 'window["__tagged"] = 7;',
  });
  // The adapter's own handle, not a copy of its fields: asElement() answers
  // with the same proxy and toString() replays the description the adapter
  // gave in the browser.
  expect(scriptHandle.asElement()).toBe(scriptHandle);
  expect(scriptHandle.toString()).toBe(
    await page.evaluate(async () =>
      String(await (window as any).__pwLiteAdapterPage.$("script"))
    )
  );
  expect(
    await scriptHandle.evaluate((element: Element) => element.tagName)
  ).toBe("SCRIPT");
  expect(await page.evaluate(() => (window as any).__tagged)).toBe(7);

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Page.addScriptTag");
  expect(execution.entered).toContain("ElementHandle.evaluate");
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("a member returning an array republishes each handle in it", async ({
  page,
  adapterPage,
}) => {
  // Stands for any member whose result mixes handles with plain values; no
  // implemented Page member returns that shape outside a dedicated route. The
  // handle is the adapter's own non-element one, so the evidence shows the kind
  // the bridge stored it under.
  await page.evaluate(() => {
    const host = window as any;
    host.__pwLiteAdapterPage.addStyleTag = async () => [
      await host.__pwLiteAdapterPage.waitForFunction(() => 42),
      "plain",
    ];
  });

  const [handle, plain] = await (adapterPage as any).addStyleTag();
  expect(plain).toBe("plain");
  expect(await handle.jsonValue()).toBe(42);

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("JSHandle.jsonValue");
  expect(execution.entered).not.toContain("ElementHandle.jsonValue");

  await handle.dispose();
  await expect(handle.jsonValue()).rejects.toThrow("Unknown or disposed");
});

// Every route that returns a handle records its members under the kind
// Playwright's own API gives the handle, whatever the route's declared return
// type: an element value is an ElementHandle and any other value a JSHandle.
// Each route is driven with the same two values and the same member, so only
// the value decides the recorded kind.
const handleRoutes: [
  string,
  (
    page: import("@playwright/test").Page,
    expression: string
  ) => Promise<import("@playwright/test").JSHandle>,
][] = [
  ["Page.evaluateHandle", (page, expression) => page.evaluateHandle(expression)],
  [
    "Page.waitForFunction",
    (page, expression) => page.waitForFunction(expression),
  ],
  [
    "JSHandle.getProperty",
    async (page, expression) =>
      (await page.evaluateHandle(`({ value: ${expression} })`)).getProperty(
        "value"
      ),
  ],
  [
    "JSHandle.getProperties",
    async (page, expression) =>
      (
        await (
          await page.evaluateHandle(`({ value: ${expression} })`)
        ).getProperties()
      ).get("value")!,
  ],
  [
    "ElementHandle.evaluateHandle",
    async (page, expression) =>
      (await page.$("div"))!.evaluateHandle(expression),
  ],
  [
    "JSHandle.evaluateHandle",
    async (page, expression) =>
      (await page.evaluateHandle("({})")).evaluateHandle(expression),
  ],
  [
    "Locator.evaluateHandle",
    (page, expression) => page.locator("div").evaluateHandle(expression),
  ],
];
for (const [route, obtain] of handleRoutes) {
  test(`a handle ${route} returns records members under the kind its value gives it`, async ({
    page,
    adapterPage,
  }) => {
    await page.setContent("<div>element</div>");
    // The kinds recorded while one member runs on the handle: the member
    // itself, plus whatever the adapter calls on the same handle internally.
    const kindsDuring = async (call: () => Promise<unknown>) => {
      const before = await page.evaluate(
        () => (window as any).__pwLiteEvidence.entered.length
      );
      const result = await call();
      const entered: string[] = await page.evaluate(
        (from) => (window as any).__pwLiteEvidence.entered.slice(from),
        before
      );
      return {
        result,
        evaluate: entered.filter((name) => name.endsWith(".evaluate")),
        kinds: [...new Set(entered.map((name) => name.split(".")[0]))],
      };
    };

    const element = await obtain(adapterPage, 'document.querySelector("div")');
    expect(element.asElement()).toBe(element);
    expect(
      await kindsDuring(() =>
        element.evaluate((value: any) => value.textContent)
      )
    ).toEqual({
      result: "element",
      evaluate: ["ElementHandle.evaluate"],
      kinds: ["ElementHandle"],
    });

    const value = await obtain(adapterPage, "42");
    expect(value.asElement()).toBeNull();
    expect(
      await kindsDuring(() => value.evaluate((value: any) => value))
    ).toEqual({
      result: 42,
      evaluate: ["JSHandle.evaluate"],
      kinds: ["JSHandle"],
    });

    expect((page as any).__pwLiteNativeOperations).toEqual([]);
  });
}

test("ElementHandle and Locator evaluateHandle run the page function on their element with its argument", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<div><span>child</span></div>");
  const div = await adapterPage.$("div");
  if (!div) throw new Error("Expected ElementHandle");
  const pageFunction = (element: Element, selector: string) =>
    element.querySelector(selector);

  const fromHandle = await div.evaluateHandle(pageFunction, "span");
  const fromLocator = await adapterPage
    .locator("div")
    .evaluateHandle(pageFunction, "span", { timeout: 500 });
  for (const handle of [fromHandle, fromLocator]) {
    expect(handle.asElement()).toBe(handle);
    expect(await handle.evaluate((element) => element!.textContent)).toBe(
      "child"
    );
  }

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("ElementHandle.evaluateHandle");
  expect(execution.entered).toContain("Locator.evaluateHandle");
  expect((page as any).__pwLiteNativeOperations).toEqual([]);
});

test("adapter element handles keep native identity, scope queries, and release bridge references", async ({
  page,
  adapterPage,
}) => {
  await page.setContent(
    '<section id="root"><span class="child">before</span></section>'
  );
  const root = await adapterPage.$("#root");
  const waited = await adapterPage.waitForSelector("#root", {
    state: "attached",
  });
  const locatorHandle = await adapterPage.locator(".child").elementHandle();
  const locatorHandles = await adapterPage.locator(".child").elementHandles();

  if (!root || !waited) throw new Error("Expected ElementHandles");

  expect(await waited.textContent()).toContain("before");
  expect(await locatorHandle.textContent()).toBe("before");
  expect(locatorHandles).toHaveLength(1);
  expect(
    await root.$eval(".child", (element: Element) => element.textContent)
  ).toBe("before");
  expect(
    await (adapterPage as any).evaluate(
      (element: Element) => element.querySelector(".child")?.textContent,
      root
    )
  ).toBe("before");

  await page.setContent(
    '<section id="root"><span class="child">after</span></section>'
  );
  expect(await root.evaluate((element: Element) => element.textContent)).toBe(
    "before"
  );

  await root.dispose();
  await expect(root.dispose()).resolves.toBeUndefined();
  await expect(root.textContent()).rejects.toThrow(/disposed|unknown/i);

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Page.$");
  expect(execution.entered).toContain("Page.waitForSelector");
  expect(execution.entered).toContain("Locator.elementHandle");
  expect(execution.entered).toContain("Locator.elementHandles");
  expect(execution.entered).toContain("ElementHandle.evaluate");
});

test("an ElementHandle member inherited from JSHandle is recorded under ElementHandle", async ({
  page,
  adapterPage,
}) => {
  // getProperty/jsonValue are declared once on AdapterJSHandle and never
  // overridden on AdapterElementHandle. instrument() must still record a call
  // to one of them under the subclass's kind, by walking the whole prototype
  // chain rather than only the handle's own immediate prototype.
  await page.setContent("<div>inherited</div>");
  const handle = await adapterPage.$("div");
  if (!handle) throw new Error("Expected ElementHandle");

  const property = await handle.getProperty("tagName");
  expect(await property.jsonValue()).toBe("DIV");

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("ElementHandle.getProperty");
  expect(execution.entered).not.toContain("JSHandle.getProperty");
});

test("adapter element handles reject references from another adapter context", async ({
  page,
}) => {
  await page.setContent('<div id="first">first</div>');
  const firstAdapter = await createAdapterPage(page);
  const firstHandle = await firstAdapter.$("#first");
  if (!firstHandle) throw new Error("Expected first ElementHandle");

  const secondAdapter = await createAdapterPage(page);
  await expect(
    secondAdapter.evaluate(
      (element: Element) => element.textContent,
      firstHandle
    )
  ).rejects.toThrow(/unknown or disposed adapter ElementHandle/i);
});

test("adapter values cannot collide with the timeout envelope", async ({
  adapterPage,
}) => {
  await expect(
    (adapterPage as any).evaluate(() => ({
      kind: "adapter-timeout",
      message: "ordinary callback value",
    }))
  ).resolves.toEqual({
    kind: "adapter-timeout",
    message: "ordinary callback value",
  });
});

test("adapter locator evaluate forwards its third timeout option", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("");
  await page.evaluate(() => {
    window.setTimeout(() => {
      document.body.innerHTML = '<p id="ready">Ready</p>';
    }, 25);
  });

  await expect(
    adapterPage
      .locator("#ready")
      .evaluate((element) => element.textContent, undefined, { timeout: 500 })
  ).resolves.toBe("Ready");

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Locator.evaluate");
});

test.describe("adapter fixture timeout configuration", () => {
  test.use({ actionTimeout: 15, navigationTimeout: 20 });

  test("applies the resolved action timeout to the adapter only", async ({
    adapterPage,
  }) => {
    const error = await adapterPage
      .locator("#missing")
      .click()
      .catch((error) => error);

    expect(error.message).toContain("Timeout 15ms exceeded");
  });
});

// ── False-green prevention: proxy does not leak to real driver ──────

test("proxy page methods do not fall through to real Playwright driver", async ({
  page,
  adapterPage,
}) => {
  const originalTitle = page.title;
  (page as any).title = () => {
    throw new Error("native title must not run");
  };
  try {
    await expect(adapterPage.title()).resolves.toBe("");
    await expect(adapterPage.pickLocator()).rejects.toThrow();
    await expect(adapterPage.screenshot()).rejects.toThrow();
    await expect((adapterPage as any).close()).rejects.toThrow();
    expect((page as any).__pwLiteNativeOperations).toEqual([]);
  } finally {
    page.title = originalTitle;
  }
});

// ── Native setup with adapter content ─────────────────────────────

test("adapter content observes native fixture setup", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<!DOCTYPE html><div>serialized</div>");
  await expect(adapterPage.content()).resolves.toBe(
    "<!DOCTYPE html><html><head></head><body><div>serialized</div></body></html>"
  );
  const execution = await adapterPage.evaluate(
    () => (window as any).__pwLiteEvidence
  );
  expect(execution.entered).toContain("Page.content");
});

// ── W-27: evaluate through the adapter bridge ──────────────────────

test("adapter evaluate runs a function and returns result", async ({
  adapterPage,
}) => {
  const result = await (adapterPage as any).evaluate(() => 2 + 3);
  expect(result).toBe(5);
});

test("adapter evaluate passes arg to function", async ({ adapterPage }) => {
  const result = await (adapterPage as any).evaluate((n: number) => n * 4, 7);
  expect(result).toBe(28);
});

test("adapter evaluate handles string expressions", async ({ adapterPage }) => {
  const result = await (adapterPage as any).evaluate("1 + 1");
  expect(result).toBe(2);
});

test("adapter evaluate propagates errors without retry", async ({
  adapterPage,
}) => {
  await expect(
    (adapterPage as any).evaluate(() => {
      throw new Error("eval-boom");
    })
  ).rejects.toThrow(/eval-boom/);
});

test("adapter evaluate can mutate the DOM", async ({ page, adapterPage }) => {
  await page.setContent('<div id="mut">before</div>');
  await (adapterPage as any).evaluate(() => {
    document.getElementById("mut")!.textContent = "after";
  });
  const text = await page.evaluate(
    () => document.getElementById("mut")?.textContent
  );
  expect(text).toBe("after");
});

// ── W-27: waitForFunction through the adapter bridge ───────────────

test("adapter waitForFunction resolves with handle.jsonValue()", async ({
  page,
  adapterPage,
}) => {
  const handle = await (adapterPage as any).waitForFunction(
    () => ((window.location.hash = "waited"), 42)
  );
  expect(await handle.jsonValue()).toBe(42);
  // Handle routes refresh the synchronous url facade like every other member.
  expect(adapterPage.url()).toBe(page.url());
});

test("adapter waitForFunction false predicate times out", async ({
  adapterPage,
}) => {
  await expect(
    (adapterPage as any).waitForFunction(
      () => false,
      {},
      {
        polling: 10,
        timeout: 100,
      }
    )
  ).rejects.toThrow(/[Tt]imeout/);
});

test("adapter timeout is rethrown without real driver fallback", async ({
  page,
  adapterPage,
}) => {
  const realWaitForFunction = page.waitForFunction;
  (page as any).waitForFunction = () => {
    throw new Error("real Playwright waitForFunction must not run");
  };

  try {
    const error = await (adapterPage as any)
      .waitForFunction(() => false, {}, { polling: 10, timeout: 25 })
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(playwrightErrors.TimeoutError);
    expect((error as Error).message).toContain(
      "page.waitForFunction: Timeout 25ms exceeded"
    );
  } finally {
    (page as any).waitForFunction = realWaitForFunction;
  }

  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toContain("Page.waitForFunction");
});

test("adapter waitForFunction string expression works", async ({
  page,
  adapterPage,
}) => {
  // Set a window variable, then wait for it via string expression.
  // The expression returns the variable itself (truthy when > 0).
  await page.evaluate(() => {
    (window as any).__testVar = 0;
    setTimeout(() => {
      (window as any).__testVar = 99;
    }, 50);
  });
  const handle = await (adapterPage as any).waitForFunction(
    "window.__testVar || 0",
    {},
    { polling: 10, timeout: 5000 }
  );
  expect(await handle.jsonValue()).toBe(99);
});

test("adapter waitForFunction callback side effects stop after resolve", async ({
  page,
  adapterPage,
}) => {
  // Set a counter that the predicate increments each poll.
  await page.evaluate(() => {
    (window as any).__sideEffectCounter = 0;
  });
  const handle = await (adapterPage as any).waitForFunction(
    () => {
      (window as any).__sideEffectCounter++;
      return (window as any).__sideEffectCounter >= 3
        ? (window as any).__sideEffectCounter
        : 0;
    },
    {},
    { polling: 10 }
  );
  const resolvedAt = await handle.jsonValue();
  expect(resolvedAt).toBeGreaterThanOrEqual(3);

  // Wait — counter should NOT keep incrementing.
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => (window as any).__sideEffectCounter);
  expect(after).toBe(resolvedAt);
});

test("adapter waitForFunction propagates thrown error", async ({
  adapterPage,
}) => {
  await expect(
    (adapterPage as any).waitForFunction(() => {
      throw new Error("predicate-boom");
    })
  ).rejects.toThrow(/predicate-boom/);
});

test("adapter waitForFunction handle.dispose() returns a promise", async ({
  adapterPage,
}) => {
  const handle = await (adapterPage as any).waitForFunction(() => 1);
  const result = handle.dispose();
  expect(result).toBeInstanceOf(Promise);
  await result;
});

// ── Proxy isolation ─────────────────────────────────────────────────

test("proxy does not expose real driver sub-objects", async ({
  page,
  adapterPage,
}) => {
  // keyboard, mouse, and touchscreen are object properties on the real
  // Playwright page. The proxy must not leak them.

  // The proxy returns a function (adapter routing), not the real object.
  const proxyKbd = (adapterPage as any).keyboard;
  const proxyMouse = (adapterPage as any).mouse;
  const proxyTouch = (adapterPage as any).touchscreen;

  expect(proxyKbd).not.toBe(page.keyboard);
  expect(proxyMouse).not.toBe(page.mouse);
  expect(proxyTouch).not.toBe(page.touchscreen);

  // Keyboard is now an adapter-owned object. Poison the native operation and
  // prove text reaches the controlled document through its browser entry.
  for (const method of ["down", "up", "press", "type", "insertText"])
    (page.keyboard as any)[method] = () => {
      throw new Error(`native keyboard.${method} must not be used`);
    };
  await adapterPage.evaluate(() => {
    document.body.innerHTML = "<input autofocus>";
    (document.querySelector("input") as HTMLInputElement).focus();
  });
  await proxyKbd.down("Shift");
  await proxyKbd.up("Shift");
  await proxyKbd.type("b");
  await proxyKbd.insertText("c");
  await proxyKbd.press("a");
  await expect(adapterPage.locator("input")).toHaveValue("bca");
  const execution = await page.evaluate(() => (window as any).__pwLiteEvidence);
  expect(execution.entered).toEqual(
    expect.arrayContaining([
      "Keyboard.down",
      "Keyboard.up",
      "Keyboard.type",
      "Keyboard.insertText",
      "Keyboard.press",
    ])
  );

  await expect((adapterPage as any).mouse("click", 0, 0)).rejects.toThrow();

  await expect((adapterPage as any).touchscreen("tap", 0, 0)).rejects.toThrow();
});
