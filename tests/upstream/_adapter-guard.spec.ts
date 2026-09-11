/**
 * Guard tests that verify the fixture routes compatibility calls
 * through the Ayme in-browser adapter, not the real Playwright driver.
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
import { TestServer } from "./testServer";

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
      expect((page as any).__aymeNativeOperations).toEqual([]);
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
    const runtime = (window as any).__aymeAdapterPage;
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
    host.__aymeAdapterPage.waitForFunction = async (
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
  await adapterPage.reload().catch(() => {});
  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).toContain("Locator.count");
  expect(execution.entered).not.toContain("Page.reload");
  expect((page as any).__aymeTransportFailures.length).toBeGreaterThan(0);
});

test("explicit out-of-scope Page methods use native operations without adapter evidence", async ({
  page,
  adapterPage,
}) => {
  await adapterPage.setContent("<p>native setup</p>");
  await adapterPage.setViewportSize({ width: 320, height: 240 });

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).not.toContain("Page.setContent");
  expect(execution.entered).not.toContain("Page.setViewportSize");
  expect((page as any).__aymeNativeOperations).toEqual([
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).not.toContain("Locator.contentFrame");
  expect(execution.entered).not.toContain("Locator.frameLocator");
  expect(execution.entered).not.toContain("Page.frameLocator");
  expect(execution.entered).not.toContain("Page.frames");
  expect(execution.entered).not.toContain("Page.frame");
  expect((page as any).__aymeNativeOperations).toEqual(
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).toContain("Locator.all");
  expect(execution.entered).not.toContain("Locator.contentFrame");
  expect((page as any).__aymeNativeOperations).toEqual(
    expect.arrayContaining(["Locator.contentFrame", "Locator.textContent"])
  );
});

test("page fixture is the adapter proxy", async ({ adapterPage }) => {
  expect((adapterPage as any).__aymeAdapter).toBe(true);
});

test("page.locator returns an adapter proxy locator", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<div></div>");
  const locator = adapterPage.locator("div");
  expect((locator as any).__aymeAdapter).toBe(true);
});

test("page.mainFrame keeps the single-document adapter facade", async ({
  page,
  adapterPage,
}) => {
  await page.setContent("<main><p>hello</p></main>");

  const mainFrame = adapterPage.mainFrame();
  expect((mainFrame as any).__aymeAdapter).toBe(true);
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
    await page.evaluate(() => (window as any).__aymeEvidence.entered)
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
            await (window as any).__aymeAdapterPage.goto(url);
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
        await page.evaluate(() => typeof (window as any).__aymeAdapterPage.goto)
      ).toBe("function");
    } finally {
      await server.close();
    }
  });
}

test("adapter goto rejects unsupported options before changing the URL", async ({
  page,
  adapterPage,
}) => {
  const before = page.url();
  await expect(
    adapterPage.goto("#changed", { waitUntil: "networkidle" })
  ).rejects.toThrow(/networkidle/);
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

  // Fixture-only coverage for the recursive codec. Production evaluation runs
  // in one browser realm and needs no Locator serializer.
  await expect(
    (adapterPage as any).evaluate(
      (value: { locators: Array<{ count(): Promise<number> }> }) =>
        Promise.all(value.locators.map((locator) => locator.count())),
      { locators: [buttons] }
    )
  ).resolves.toEqual([2]);

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
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
  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).toContain("Locator.evaluate");
  expect(execution.entered).toContain("Locator.evaluateAll");
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).toContain("Page.evaluate");
  expect(execution.entered).toContain("Page.$eval");
  expect(execution.entered).toContain("Page.$$eval");
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
  expect(execution.entered).toContain("Page.$");
  expect(execution.entered).toContain("Page.waitForSelector");
  expect(execution.entered).toContain("Locator.elementHandle");
  expect(execution.entered).toContain("Locator.elementHandles");
  expect(execution.entered).toContain("ElementHandle.evaluate");
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
      __aymeAdapterTimeout: true,
      message: "ordinary callback value",
    }))
  ).resolves.toEqual({
    __aymeAdapterTimeout: true,
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
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
    await expect(adapterPage.goBack()).rejects.toThrow();
    await expect(adapterPage.screenshot()).rejects.toThrow();
    await expect(
      (adapterPage as any).route("**/*", () => {})
    ).rejects.toThrow();
    expect((page as any).__aymeNativeOperations).toEqual([]);
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
    () => (window as any).__aymeEvidence
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
  adapterPage,
}) => {
  const handle = await (adapterPage as any).waitForFunction(() => 42);
  expect(await handle.jsonValue()).toBe(42);
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

  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
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
  const execution = await page.evaluate(() => (window as any).__aymeEvidence);
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
