/* eslint-disable @typescript-eslint/no-explicit-any -- the ledger walk calls members by name, and `window` properties the type does not know about */
import { describe, expect, it } from "vitest";

import { locatorLedger, pageLedger } from "../../compatibility/api";
import { createPage } from "../../src/index";

const closedMessage = "Target page, context or browser has been closed";

async function rejection(promise: Promise<unknown>) {
  return (await promise.then(
    () => undefined,
    (error) => error
  )) as Error | undefined;
}

/**
 * Calls every implemented member of `ledger` on `target` without arguments
 * and returns the async ones by the rejection each settled with. `close`
 * itself is skipped: closing again resolves.
 */
async function callEvery(
  target: object,
  ledger: Record<string, { status: string }>
): Promise<[string, Error | undefined][]> {
  const settled: [string, Error | undefined][] = [];
  for (const [name, entry] of Object.entries(ledger)) {
    const member = (target as any)[name];
    if (
      name === "close" ||
      entry.status !== "implemented" ||
      typeof member !== "function"
    )
      continue;
    let result: unknown;
    try {
      result = member.call(target);
    } catch {
      // A sync member rejecting its missing arguments is still available.
      continue;
    }
    if (typeof (result as { then?: unknown })?.then === "function")
      settled.push([name, await rejection(result as Promise<unknown>)]);
  }
  return settled;
}

describe("Page.close", () => {
  it("resolves after firing close with the page, and resolves again when called twice", async () => {
    const page = createPage();
    const closed: unknown[] = [];
    page.on("close", (closedPage) => closed.push(closedPage));
    const waited = page.waitForEvent("close");

    await Promise.all([page.close(), page.close()]);
    await page.close();

    expect(closed).toEqual([page]);
    await expect(waited).resolves.toBe(page);
  });

  it("rejects every later async call with the closed error, while sync members keep answering", async () => {
    document.body.innerHTML = "<input id=input>";
    const page = createPage();
    const locator = page.locator("#input");
    const handle = (await page.$("#input"))!;
    const jsHandle = await page.evaluateHandle(() => ({ a: 1 }));
    await page.close();

    const pageCalls = await callEvery(
      page,
      pageLedger as Record<string, { status: string }>
    );
    const locatorCalls = await callEvery(
      locator,
      locatorLedger as Record<string, { status: string }>
    );
    expect(pageCalls.length).toBeGreaterThan(50);
    expect(locatorCalls.length).toBeGreaterThan(40);
    for (const [name, error] of pageCalls)
      expect(error?.message, name).toBe(`page.${name}: ${closedMessage}`);
    for (const [name, error] of locatorCalls)
      expect(error?.message, name).toBe(`locator.${name}: ${closedMessage}`);

    const owned: [string, () => Promise<unknown>][] = [
      ["keyboard.press", () => page.keyboard.press("a")],
      ["mouse.click", () => page.mouse.click(1, 1)],
      ["mouse.wheel", () => page.mouse.wheel(0, 10)],
      ["webStorage.getItem", () => page.localStorage.getItem("a")],
      ["webStorage.setItem", () => page.sessionStorage.setItem("a", "b")],
      ["elementHandle.click", () => handle.click()],
      ["elementHandle.evaluate", () => handle.evaluate((e) => e.id)],
      ["jsHandle.jsonValue", () => jsHandle.jsonValue()],
    ];
    for (const [apiName, run] of owned) {
      const error = await rejection(run());
      expect(error?.name, apiName).toBe("Error");
      expect(error?.message, apiName).toBe(`${apiName}: ${closedMessage}`);
    }
    await expect(handle.dispose()).resolves.toBeUndefined();

    expect(page.url()).toBe(location.href);
    expect(page.locator("#input").toString()).toBe("locator('#input')");
  });

  it("rejects pending calls no signal can stop", async () => {
    document.body.innerHTML = "<input id=input>";
    const page = createPage();
    const pending: [string, Promise<unknown>][] = [
      ["page.evaluate", page.evaluate(() => new Promise(() => {}))],
      [
        "locator.evaluate",
        page.locator("#input").evaluate(() => new Promise(() => {})),
      ],
      ["page.waitForTimeout", page.waitForTimeout(60_000)],
      ["keyboard.type", page.keyboard.type("abc", { delay: 60_000 })],
      ["mouse.click", page.mouse.click(1, 1, { delay: 60_000 })],
    ];
    await page.close();

    for (const [apiName, promise] of pending)
      expect((await rejection(promise))?.message, apiName).toBe(
        `${apiName}: ${closedMessage}`
      );
  });

  it("stops a pending mouse call at its next event", async () => {
    const page = createPage();
    let afterClose = 0;
    let closed = false;
    const count = () => {
      if (closed) afterClose++;
    };
    for (const type of ["pointermove", "mousemove", "mousedown", "click"])
      document.addEventListener(type, count);
    try {
      const moving = page.mouse.move(200, 200, { steps: 200 });
      const clicking = page.mouse.dblclick(20, 20);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await page.close();
      closed = true;

      expect((await rejection(moving))?.message).toBe(
        `mouse.move: ${closedMessage}`
      );
      expect((await rejection(clicking))?.message).toBe(
        `mouse.dblclick: ${closedMessage}`
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(afterClose).toBe(0);
    } finally {
      for (const type of ["pointermove", "mousemove", "mousedown", "click"])
        document.removeEventListener(type, count);
    }
  });

  it("reports the reason to interrupted calls and the default message to later calls", async () => {
    const page = createPage();
    const interrupted = page.waitForFunction(() => false);
    const waited = page.waitForEvent("load");

    await page.close({ reason: "Test is done" });

    expect((await rejection(interrupted))?.message).toBe(
      "page.waitForFunction: Test is done"
    );
    expect((await rejection(waited))?.message).toBe(
      "page.waitForEvent: Test is done"
    );
    expect((await rejection(page.title()))?.message).toBe(
      `page.title: ${closedMessage}`
    );
  });

  it("releases the host wrappers it installed, keeping those another open page still uses", async () => {
    const wrapped = () => ({
      fetch: window.fetch,
      send: XMLHttpRequest.prototype.send,
      alert: window.alert,
      log: console.log,
      click: HTMLElement.prototype.click,
      showPicker: HTMLInputElement.prototype.showPicker,
    });
    const original = wrapped();
    const first = createPage();
    const second = createPage();
    for (const page of [first, second]) {
      page.on("request", () => {});
      page.on("dialog", () => {});
      page.on("filechooser", () => {});
      page.on("console", () => {});
    }
    const installed = wrapped();

    await first.close();

    expect(wrapped()).toEqual(installed);
    const message = second.waitForEvent("console");
    console.log("still observed");
    expect((await message).text()).toBe("still observed");

    await second.close();

    expect(wrapped()).toEqual(original);
  });

  it("removes the functions and bindings it exposed", async () => {
    const other = createPage();
    const page = createPage();
    await other.exposeFunction("otherFunction", () => 1);
    await page.exposeFunction("closedFunction", () => 2);
    await page.exposeBinding("closedBinding", () => 3);

    await page.close();

    expect("closedFunction" in window).toBe(false);
    expect("closedBinding" in window).toBe(false);
    await expect(
      other.evaluate(() => (window as any).otherFunction())
    ).resolves.toBe(1);

    await other.close();

    expect("otherFunction" in window).toBe(false);
    expect((window as any).__playwright__binding__controller__).toBeUndefined();
  });

  it("leaves the document open for another page", async () => {
    document.body.innerHTML = "<p>kept</p>";
    const page = createPage();

    await page.close();

    expect(document.body.innerHTML).toBe("<p>kept</p>");
    await expect(createPage().locator("p").textContent()).resolves.toBe("kept");
  });

  it("stays open when runBeforeUnload is requested, and closes with it false", async () => {
    const page = createPage();

    await expect(page.close({ runBeforeUnload: true })).rejects.toThrow(
      "close(): unsupported Playwright option(s): runBeforeUnload."
    );

    expect(page.isClosed()).toBe(false);
    await expect(page.title()).resolves.toBe(document.title);

    await page.close({ runBeforeUnload: false });

    expect(page.isClosed()).toBe(true);
  });

  it("leaves no unhandled rejection when a page function closes its page and then rejects", async () => {
    const page = createPage();
    const unhandled: unknown[] = [];
    const record = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", record);
    (window as any).closingPage = page;
    try {
      const error = await rejection(
        page.evaluate(() => {
          void (window as any).closingPage.close();
          return Promise.reject(new Error("after close"));
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(error?.message).toBe(`page.evaluate: ${closedMessage}`);
      expect(unhandled).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", record);
      delete (window as any).closingPage;
    }
  });

  it("closes through Symbol.asyncDispose", async () => {
    let disposed: ReturnType<typeof createPage>;
    {
      await using page = createPage();
      disposed = page;
      expect(page.isClosed()).toBe(false);
    }

    expect(disposed.isClosed()).toBe(true);
  });
});
