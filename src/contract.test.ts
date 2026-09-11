/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it, afterEach, vi } from "vitest";

import {
  createPage,
  isAymeLocator,
  LOCATOR_BRAND,
  resolveLocatorElements,
} from "./index";
import { AdapterJSHandle, PageImpl } from "./page";
import { ADAPTER_TIMEOUT_ERROR } from "./errors";

const compiledTimeoutGlobals = {
  action: "__AYME_PLAYWRIGHT_ACTION_TIMEOUT__",
  navigation: "__AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__",
} as const;

function installCompiledTimeouts(
  actionTimeout: number | undefined,
  navigationTimeout: number | undefined
) {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values = [
    [compiledTimeoutGlobals.action, actionTimeout],
    [compiledTimeoutGlobals.navigation, navigationTimeout],
  ] as const;

  for (const [name, value] of values) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }

  return () => {
    for (const [name] of values) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  };
}

describe("Single-document adapter contract", () => {
  describe("ARIA snapshots", () => {
    it("captures the current document through the compiled InjectedScript", async () => {
      document.body.innerHTML = "<h1>Accessible title</h1>";
      const page = createPage();

      await expect((page as any).ariaSnapshot()).resolves.toContain(
        'heading "Accessible title" [level=1]'
      );
    });

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

    it("honors aborted signals and waits for default-mode locator targets", async () => {
      const page = createPage();
      const aborted = new AbortController();
      aborted.abort("stop snapshot");

      await expect(
        (page as any).ariaSnapshot({ signal: aborted.signal })
      ).rejects.toThrow("Query was aborted: stop snapshot");

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
      await expect(
        (page as any)
          .locator("#missing")
          .ariaSnapshot({ timeout: 100, signal: cancelled.signal })
      ).rejects.toThrow("Query was aborted: cancel snapshot");
    });
  });

  describe("browser-native callbacks", () => {
    it("runs Page.$eval and $$eval against current-document elements", async () => {
      document.body.innerHTML = "<p>A</p><p>B</p>";
      const page = createPage();

      await expect(
        (page as any).$eval(
          "p:first-child",
          (element: Element, suffix: string) => element.textContent + suffix,
          "!"
        )
      ).resolves.toBe("A!");
      await expect(
        (page as any).$eval("p", (element: Element) => element.textContent)
      ).resolves.toBe("A");
      await expect(
        (page as any).$$eval("p", (elements: Element[]) =>
          elements.map((element) => element.textContent)
        )
      ).resolves.toEqual(["A", "B"]);
    });

    it("runs Locator callbacks directly without callback-source transport", async () => {
      document.body.innerHTML = "<li>One</li><li>Two</li>";
      const page = createPage();
      const items = page.locator("li");

      await expect(
        items
          .first()
          .evaluate(
            (element, suffix: string) => element.textContent + suffix,
            "!"
          )
      ).resolves.toBe("One!");
      await expect(
        items.evaluateAll((elements) =>
          elements.map((element) => element.textContent)
        )
      ).resolves.toEqual(["One", "Two"]);
    });

    it("waits for a strict Locator.evaluate target and honors its options", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      window.setTimeout(
        () => (document.body.innerHTML = "<p id=ready>Ready</p>"),
        25
      );

      await expect(
        page
          .locator("#ready")
          .evaluate((element) => element.textContent, undefined, {
            timeout: 100,
          })
      ).resolves.toBe("Ready");

      document.body.innerHTML = "<p>First</p><p>Second</p>";
      await expect(
        page.locator("p").evaluate((element) => element.textContent)
      ).rejects.toThrow(/strict mode violation/);

      const cancelled = new AbortController();
      window.setTimeout(() => cancelled.abort("cancel evaluate"), 10);
      await expect(
        page
          .locator("#missing")
          .evaluate((element) => element.textContent, undefined, {
            timeout: 100,
            signal: cancelled.signal,
          })
      ).rejects.toThrow("Query was aborted: cancel evaluate");
    });
  });

  describe("fixed element handles", () => {
    it("keeps page dollar results fixed while querying within their subtree", async () => {
      document.body.innerHTML =
        '<section id="root"><span class="child">before</span></section>';
      const page = createPage();
      const root = await page.$("#root");

      expect(root).toBeTruthy();
      if (!root) throw new Error("Expected root ElementHandle");
      expect(await page.$$(".child")).toHaveLength(1);
      await expect(
        root.$eval(".child", (element) => element.textContent)
      ).resolves.toBe("before");

      document.body.innerHTML = "";
      window.setTimeout(
        () => (document.body.innerHTML = '<p id="ready">ready</p>'),
        10
      );
      const waited = await page.waitForSelector("#ready", {
        state: "attached",
        timeout: 100,
      });
      if (!waited) throw new Error("Expected attached ElementHandle");
      await expect(waited.textContent()).resolves.toBe("ready");

      document.body.innerHTML =
        '<section id="root"><span class="child">after</span></section>';

      await expect(
        root.evaluate((element) => element.textContent)
      ).resolves.toBe("before");
      await expect(
        root.$eval(".child", (element) => element.textContent)
      ).resolves.toBe("before");
    });

    it("returns fixed locator handle snapshots, distinguishes detached states, and releases disposed handles", async () => {
      document.body.innerHTML =
        '<input id="first" value="one"><input value="two">';
      const page = createPage();
      const handles = await page.locator("input").elementHandles();

      expect(handles).toHaveLength(2);
      expect(await handles[0].inputValue()).toBe("one");
      document.getElementById("first")!.remove();
      await expect(
        handles[0].waitForElementState("hidden", { timeout: 50 })
      ).resolves.toBeUndefined();
      await expect(
        handles[0].waitForElementState("visible", { timeout: 50 })
      ).rejects.toThrow("Element is not connected");
      await expect(
        handles[0].waitForElementState("enabled", { timeout: 50 })
      ).rejects.toThrow("Element is not connected");

      await handles[0].dispose();
      await expect(handles[0].dispose()).resolves.toBeUndefined();
      await expect(handles[0].textContent()).rejects.toThrow(/disposed/i);
    });

    it("bounds a stalled pinned stability check by the explicit timeout", async () => {
      document.body.innerHTML = '<div id="target"></div>';
      const page = PageImpl.fromWindow(window);
      const injected = (
        page as unknown as {
          actionableInjected: {
            checkElementStates: () => Promise<never>;
          };
        }
      ).actionableInjected;
      const checkElementStates = vi
        .spyOn(injected, "checkElementStates")
        .mockImplementation(() => new Promise<never>(() => {}));
      try {
        const target = await page.$("#target");

        if (!target) throw new Error("Expected target ElementHandle");
        const outcome = await Promise.race([
          target.waitForElementState("stable", { timeout: 25 }).then(
            () => "resolved",
            (error: unknown) => error
          ),
          new Promise((resolve) => window.setTimeout(resolve, 75, "pending")),
        ]);

        expect(outcome).toMatchObject({
          message: "elementHandle.waitForElementState: Timeout 25ms exceeded.",
        });
      } finally {
        checkElementStates.mockRestore();
      }
    });

    it("resolves Locator.elementHandle strictly as an attached fixed element", async () => {
      document.body.innerHTML = "<p>first</p><p>second</p>";
      const page = createPage();

      await expect(page.locator("p").elementHandle()).rejects.toThrow(
        /strict mode violation/
      );
      await expect(
        page.locator("p").first().elementHandle()
      ).resolves.toBeTruthy();
    });

    it("uses native element handles as page evaluation and wait arguments", async () => {
      document.body.innerHTML = '<div id="target">before</div>';
      const page = createPage();
      const target = await page.$("#target");
      if (!target) throw new Error("Expected target ElementHandle");

      await expect(
        page.evaluate((element: Element) => element.textContent, target)
      ).resolves.toBe("before");

      const waiting = page.waitForFunction(
        (element: Element) => element.textContent === "after",
        target,
        { polling: 1, timeout: 100 }
      );
      target.evaluate((element: Element) => (element.textContent = "after"));
      await expect(waiting).resolves.toBeTruthy();
    });
  });

  describe("small single-document methods", () => {
    it("returns the current document URL and waits for a plain timeout", async () => {
      const page = createPage();
      expect((page as any).url()).toBe(window.location.href);
      await expect((page as any).waitForTimeout(0)).resolves.toBeUndefined();
    });

    it("preserves pinned locator description precedence and readable strings", () => {
      const page = createPage();
      const locator = page.getByRole("button", { name: "Save" });
      expect(locator.description()).toBeNull();
      expect(locator.toString()).toBe("getByRole('button', { name: 'Save' })");
      expect(locator.describe("Save button").description()).toBe("Save button");
      expect(locator.describe("Save button").toString()).toBe("Save button");
      expect(locator.describe("").description()).toBe("");
      expect(
        page
          .locator("form")
          .locator("input")
          .describe("Form input field")
          .description()
      ).toBe("Form input field");

      const first = page.locator("foo").describe("First description");
      const second = first.locator("button").describe("Second description");
      expect(first.description()).toBe("First description");
      expect(second.description()).toBe("Second description");
      expect(second.locator("button").description()).toBeNull();
    });
  });

  // ── AC1: createPage targets only the current Window ────────────

  it("createPage uses the current window without an alternate-window option", () => {
    const page = createPage();
    expect(page).toBeDefined();
    expect(page.locator("body")).toBeDefined();
  });

  describe("Page compatibility façade", () => {
    it("delegates title and selector queries to the controlled document", async () => {
      document.title = "Adapter title";
      document.body.innerHTML = `
        <p id=copy>Hello <strong>world</strong></p>
        <input id=editable />
        <div id=hidden hidden>Hidden</div>
        <div>First</div><div>Second</div>
      `;
      const page = createPage();

      await expect(page.title()).resolves.toBe("Adapter title");
      await expect(page.innerText("#copy")).resolves.toBe("Hello world");
      await expect(page.innerHTML("#copy")).resolves.toBe(
        "Hello <strong>world</strong>"
      );
      await expect(page.isEditable("#editable")).resolves.toBe(true);
      await expect(page.isVisible("#missing")).resolves.toBe(false);
      await expect(page.isHidden("#missing")).resolves.toBe(true);
      await expect(page.isVisible("#hidden")).resolves.toBe(false);
      await expect(page.isVisible("div")).resolves.toBe(false);
      await expect(page.isVisible("div", { strict: true })).rejects.toThrow(
        "strict mode violation"
      );
    });

    it("lets :has-text match the HTML root", async () => {
      document.body.innerHTML = "<span>Find me</span>";
      const page = createPage() as unknown as PageImpl;

      expect(page.resolveAll(':has-text("find me")')[0]).toBe(
        document.documentElement
      );
      await expect(
        page.$eval(':has-text("find me")', (element) => element.tagName)
      ).resolves.toBe("HTML");
    });

    it("delegates browser-feasible Page actions without recursive dispatch", async () => {
      document.body.innerHTML = `
        <button id=button>Click</button>
        <input id=input />
        <input id=check type=checkbox />
        <select id=select><option value=one>One</option></select>
      `;
      const page = createPage();
      const button = document.querySelector("#button")!;
      let clicks = 0;
      let hovers = 0;
      button.addEventListener("click", () => clicks++);
      button.addEventListener("mouseover", () => hovers++);

      await page.click("#button");
      await page.fill("#input", "a");
      await page.press("#input", "b");
      await page.type("#input", "cd");
      await page.focus("#input");
      await page.hover("#button");
      await page.check("#check");
      await page.uncheck("#check");
      await page.setChecked("#check", true);
      await expect(page.selectOption("#select", "one")).resolves.toEqual([
        "one",
      ]);

      expect(clicks).toBe(1);
      expect(hovers).toBe(2);
      expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
        "abcd"
      );
      expect(
        (document.querySelector("#check") as HTMLInputElement).checked
      ).toBe(true);
    });

    it("applies stored default timeouts to queries and waitForFunction", async () => {
      const page = createPage();
      page.setDefaultTimeout(20);

      await expect(page.innerText("#missing")).rejects.toThrow(
        "Timeout 20ms exceeded"
      );
      const waitForStateError = await page
        .locator("#missing")
        .waitFor()
        .catch((error) => error);
      expect(waitForStateError.name).toBe("TimeoutError");
      expect(waitForStateError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
      expect(waitForStateError.message).toContain("Timed out waiting");

      const actionError = await page.check("#missing").catch((error) => error);
      expect(actionError.name).toBe("TimeoutError");
      expect(actionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
      expect(actionError.message).toContain("Timeout 20ms exceeded");

      const locatorActionError = await page
        .locator("#missing-locator-action")
        .click()
        .catch((error) => error);
      expect(locatorActionError.name).toBe("TimeoutError");
      expect(locatorActionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
      expect(locatorActionError.message).toContain("Timeout 20ms exceeded");

      const waitForFunctionError = await page
        .waitForFunction(() => false)
        .catch((error) => error);
      expect(waitForFunctionError.name).toBe("TimeoutError");
      expect(waitForFunctionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
      expect(waitForFunctionError.message).toBe(
        "page.waitForFunction: Timeout 20ms exceeded."
      );
    });

    it("applies compiled defaults to the page returned by createPage", async () => {
      const restoreCompiledTimeouts = installCompiledTimeouts(5, undefined);

      try {
        document.body.innerHTML = "";
        const page = createPage();

        await expect(page.locator("#missing").click()).rejects.toThrow(
          "Timeout 5ms exceeded"
        );
      } finally {
        restoreCompiledTimeouts();
      }
    });

    it("applies compiled and runtime navigation defaults to same-document goto", async () => {
      const restoreCompiledTimeouts = installCompiledTimeouts(undefined, 7);
      const originalSetTimeout = window.setTimeout;
      const navigationTimeouts: number[] = [];
      window.setTimeout = ((
        handler: TimerHandler,
        timeout?: number,
        ...args: any[]
      ) => {
        if (timeout !== undefined) navigationTimeouts.push(timeout);
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof window.setTimeout;

      try {
        const page = createPage();

        await expect(page.goto("#compiled")).resolves.toBeNull();
        expect(navigationTimeouts).toContain(7);

        page.setDefaultNavigationTimeout(11);
        await expect(page.goto("#runtime")).resolves.toBeNull();
        expect(navigationTimeouts).toContain(11);

        await expect(
          page.goto("#explicit", { timeout: 13 })
        ).resolves.toBeNull();
        expect(navigationTimeouts).toContain(13);
        const scheduledBeforeZero = navigationTimeouts.length;
        await expect(page.goto("#zero", { timeout: 0 })).resolves.toBeNull();
        expect(navigationTimeouts).toHaveLength(scheduledBeforeZero);
      } finally {
        window.setTimeout = originalSetTimeout;
        restoreCompiledTimeouts();
      }
    });
  });

  // ── AC2: filter serialization (JSON.stringify) ────────────────

  describe("filter", () => {
    it("preserves an empty filter without corrupting the selector", async () => {
      document.body.innerHTML = "<div><span>A</span></div>";
      const page = createPage();
      const base = page.locator("div");
      const filtered = base.filter({});
      expect(await filtered.count()).toBe(1);
    });

    it("serializes has with JSON.stringify quoting", async () => {
      document.body.innerHTML = `
        <div><span class="inner">match</span></div>
        <div><span class="other">no-match</span></div>
      `;
      const page = createPage();
      const inner = page.locator("span.inner");
      const filtered = page.locator("div").filter({ has: inner });
      expect(await filtered.count()).toBe(1);
    });

    it("serializes hasNot with JSON.stringify quoting", async () => {
      document.body.innerHTML = `
        <div><span class="exclude">excluded</span></div>
        <div><span class="keep">kept</span></div>
      `;
      const page = createPage();
      const exclude = page.locator("span.exclude");
      const filtered = page.locator("div").filter({ hasNot: exclude });
      expect(await filtered.count()).toBe(1);
    });

    it("supports visible filter option", async () => {
      document.body.innerHTML = `
        <div style="display:none">hidden</div>
        <div>visible</div>
      `;
      const page = createPage();
      const visible = page.locator("div").filter({ visible: true });
      expect(await visible.count()).toBe(1);
    });

    it("rejects a cross-page locator in has", () => {
      const page1 = createPage();
      const page2 = createPage();
      const loc2 = page2.locator("div");
      expect(() => page1.locator("div").filter({ has: loc2 })).toThrow(
        /same frame/
      );
    });

    it("rejects a cross-page locator in hasNot", () => {
      const page1 = createPage();
      const page2 = createPage();
      const loc2 = page2.locator("div");
      expect(() => page1.locator("div").filter({ hasNot: loc2 })).toThrow(
        /same frame/
      );
    });
  });

  describe("Locator.and and Locator.or", () => {
    it("intersects and unions selectors using pinned serialization", async () => {
      document.body.innerHTML = `
        <button class=primary>Save</button>
        <button class=secondary>Cancel</button>
        <a class=primary>Save link</a>
      `;
      const page = createPage();
      const buttons = page.getByRole("button");
      const primary = page.locator(".primary");

      expect(await buttons.and(primary).allTextContents()).toEqual(["Save"]);
      expect(await buttons.or(primary).allTextContents()).toEqual([
        "Save",
        "Cancel",
        "Save link",
      ]);
    });

    it("rejects locators from another page", () => {
      const first = createPage();
      const second = createPage();
      expect(() => first.locator("div").and(second.locator("div"))).toThrow(
        /same frame/
      );
      expect(() => first.locator("div").or(second.locator("div"))).toThrow(
        /same frame/
      );
    });
  });

  // ── AC2 extension: locator(selector, options) ─────────────────

  describe("locator with options", () => {
    it("Locator.locator accepts LocatorOptions (without visible)", async () => {
      document.body.innerHTML = `
        <ul>
          <li><span>A</span></li>
          <li><span>B</span></li>
        </ul>
      `;
      const page = createPage();
      const items = page.locator("li").locator("span", { hasText: "A" });
      expect(await items.count()).toBe(1);
    });

    it("Page.locator accepts LocatorOptions including visible", async () => {
      document.body.innerHTML = `
        <div style="display:none">hidden</div>
        <div>visible</div>
      `;
      const page = createPage();
      // Playwright types don't expose visible on Page.locator options, but our
      // implementation accepts the full LocatorOptions shape
      const visible = (page as any).locator("div", { visible: true });
      expect(await visible.count()).toBe(1);
    });

    it("Page.locator accepts has/hasNot options", async () => {
      document.body.innerHTML = `
        <div><span>hello</span></div>
        <div><span>world</span></div>
      `;
      const page = createPage();
      const filtered = page.locator("div", { hasText: "hello" });
      expect(await filtered.count()).toBe(1);
    });
  });

  // ── Locator.locator(Locator) with internal:chain ──────────────

  describe("Locator.locator(Locator) via internal:chain", () => {
    it("accepts a locator as first argument", async () => {
      document.body.innerHTML = `
        <div>one <span>two</span> <button>three</button></div>
        <span>four</span>
        <button>five</button>
      `;
      const page = createPage();
      const inner = page.locator("button");
      const chained = page.locator("div").locator(inner);
      expect(await chained.count()).toBe(1);
    });

    it("rejects cross-page locator in Locator.locator()", () => {
      const page1 = createPage();
      const page2 = createPage();
      const loc2 = page2.locator("div");
      expect(() => page1.locator("div").locator(loc2)).toThrow(/same frame/);
    });
  });

  // ── AC3: locator brand (structured payload, no instanceof) ────

  describe("locator brand", () => {
    it("isAymeLocator detects a real locator", () => {
      const page = createPage();
      const loc = page.locator("div");
      expect(isAymeLocator(loc)).toBe(true);
    });

    it("isAymeLocator rejects a plain object", () => {
      expect(isAymeLocator({ selector: "div" })).toBe(false);
    });

    it("isAymeLocator rejects null", () => {
      expect(isAymeLocator(null)).toBe(false);
    });

    it("isAymeLocator rejects a boolean brand (no structured payload)", () => {
      const fake = { [LOCATOR_BRAND]: true };
      expect(isAymeLocator(fake)).toBe(false);
    });

    it("brand payload exposes getSelector and resolveElements", () => {
      document.body.innerHTML = "<div>test</div>";
      const page = createPage();
      const loc = page.locator("div");
      const payload = (loc as any)[LOCATOR_BRAND];
      expect(typeof payload.getSelector).toBe("function");
      expect(typeof payload.resolveElements).toBe("function");
      expect(payload.resolveElements()).toHaveLength(1);
    });

    it("rejects a plain object in filter.has", () => {
      const page = createPage();
      const fakeLocator = { selector: "div" };
      expect(() =>
        page.locator("div").filter({ has: fakeLocator as any })
      ).toThrow(/expected an Ayme Locator/);
    });

    it("skips null/undefined in filter.has (falsy, matches Playwright truthy check)", () => {
      document.body.innerHTML = "<div>ok</div>";
      const page = createPage();
      const loc = page.locator("div").filter({ has: null as any });
      expect(loc).toBeDefined();
    });

    it("rejects a number in filter.hasNot with diagnostic type", () => {
      const page = createPage();
      expect(() => page.locator("div").filter({ hasNot: 42 as any })).toThrow(
        /expected an Ayme Locator.*got number/
      );
    });
  });

  // ── Shared resolver ───────────────────────────────────────────

  describe("shared resolver", () => {
    it("resolveLocatorElements returns matching elements", () => {
      document.body.innerHTML = "<ul><li>A</li><li>B</li></ul>";
      const page = createPage();
      const loc = page.locator("li");
      const elements = resolveLocatorElements(loc);
      expect(elements).toHaveLength(2);
    });

    it("resolveLocatorElements throws for non-locator", () => {
      expect(() => resolveLocatorElements({})).toThrow(
        /expected an Ayme Locator/
      );
    });

    it("resolveLocatorElements throws for null", () => {
      expect(() => resolveLocatorElements(null)).toThrow(
        /expected an Ayme Locator.*got null/
      );
    });
  });

  // ── AC4: unsupported options rejection ────────────────────────

  describe("unsupported options", () => {
    it("click rejects unsupported options", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      await expect(
        page.locator("button").click({ force: true } as any)
      ).rejects.toThrow(/unsupported Playwright option.*force/);
    });

    it("ignores unsupported options whose values are undefined", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      let clicks = 0;
      document.querySelector("button")!.addEventListener("click", () => {
        clicks++;
      });

      await page.locator("button").click({ force: undefined } as any);
      expect(clicks).toBe(1);
    });

    it("rejects defined unsupported option values, including false and null", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      for (const force of [false, null]) {
        await expect(
          page.locator("button").click({ force } as any)
        ).rejects.toThrow(/unsupported Playwright option.*force/);
      }
    });

    it("rejects action options other than timeout", async () => {
      document.body.innerHTML = '<input type="text" />';
      const page = createPage();
      await expect(
        page.locator("input").fill("x", { force: true } as any)
      ).rejects.toThrow(/unsupported Playwright option.*force/);
    });

    it("press rejects unsupported options", async () => {
      document.body.innerHTML = '<input type="text" />';
      const page = createPage();
      await expect(
        page.locator("input").press("a", { delay: 100 } as any)
      ).rejects.toThrow(/unsupported Playwright option.*delay/);
    });

    it("forwards explicit timeout through locator terminal actions", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      const locator = page.locator("#missing");
      const actions = [
        () => locator.click({ timeout: 1 } as any),
        () => locator.fill("value", { timeout: 1 } as any),
        () => locator.press("x", { timeout: 1 } as any),
        () => locator.clear({ timeout: 1 } as any),
        () => locator.hover({ timeout: 1 } as any),
        () => locator.check({ timeout: 1 } as any),
        () => locator.uncheck({ timeout: 1 } as any),
        () => locator.setChecked(true, { timeout: 1 } as any),
        () => locator.selectOption("value", { timeout: 1 } as any),
        () => locator.selectText({ timeout: 1 } as any),
        () => locator.scrollIntoViewIfNeeded({ timeout: 1 } as any),
      ];

      for (const action of actions)
        await expect(action()).rejects.toThrow("Timeout 1ms exceeded");
    });

    it("preserves zero as an unbounded explicit locator action timeout", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      page.setDefaultTimeout(1);
      let clicks = 0;
      window.setTimeout(() => {
        document.body.innerHTML = '<button id="late">Late</button>';
        document
          .querySelector("#late")
          ?.addEventListener("click", () => clicks++);
      }, 25);

      await page.locator("#late").click({ timeout: 0 } as any);
      expect(clicks).toBe(1);
    });

    it("bounds a suspended stability check without a late click", async () => {
      document.body.innerHTML = '<button id="button">Click</button>';
      const button = document.querySelector("#button")!;
      let clicks = 0;
      button.addEventListener("click", () => clicks++);
      const requestAnimationFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = (() =>
        0) as typeof window.requestAnimationFrame;
      try {
        const page = createPage();
        await expect(
          page.locator("#button").click({ timeout: 20 } as any)
        ).rejects.toThrow("Timeout 20ms exceeded");
        expect(clicks).toBe(0);
      } finally {
        window.requestAnimationFrame = requestAnimationFrame;
      }
    }, 500);

    it("fills text in one input event and does not type later characters after timeout", async () => {
      document.body.innerHTML = '<input id="input" />';
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      const values: string[] = [];
      input.addEventListener("input", () => values.push(input.value));
      await page.fill("#input", "ab");
      expect(values).toEqual(["ab"]);
      page.setDefaultTimeout(20);

      input.value = "";
      await expect(page.type("#input", "ab", { delay: 100 })).rejects.toThrow(
        "Timeout 20ms exceeded"
      );
      await page.waitForTimeout(120);
      expect(input.value).toBe("a");
    });

    it("waitFor supports attached state even when hidden", async () => {
      document.body.innerHTML = "<div hidden>attached</div>";
      const page = createPage();
      await expect(
        page.locator("div").waitFor({ state: "attached" })
      ).resolves.toBeUndefined();
    });

    it("waitFor supports detached state", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      await expect(
        page.locator("div").waitFor({ state: "detached" })
      ).resolves.toBeUndefined();
    });

    it("click succeeds without options", async () => {
      document.body.innerHTML = "<button>ok</button>";
      const page = createPage();
      await page.locator("button").click();
    });

    it("waitFor defaults to visible state", async () => {
      document.body.innerHTML = "<div>visible</div>";
      const page = createPage();
      await page.locator("div").waitFor();
    });

    it("waitFor succeeds with supported options only", async () => {
      document.body.innerHTML = "<div>visible</div>";
      const page = createPage();
      await page.locator("div").waitFor({ state: "visible", timeout: 1000 });
    });
  });

  // ── W-34: browser-side action semantics ───────────────────────

  describe("browser-side actions", () => {
    it("retries hidden and disabled actions until the state becomes actionable", async () => {
      document.body.innerHTML = `
        <button id="button" style="display:none">go</button>
        <input id="input" disabled />
      `;
      const page = createPage();
      let clicked = false;
      document
        .querySelector("#button")!
        .addEventListener("click", () => (clicked = true));

      window.setTimeout(() => {
        document.querySelector("#button")!.removeAttribute("style");
        (document.querySelector("#input") as HTMLInputElement).disabled = false;
      }, 25);

      await page.locator("#button").click();
      await page.locator("#input").fill("ready");

      expect(clicked).toBe(true);
      expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
        "ready"
      );
    });

    it("times out hidden or disabled actions without dispatching events", async () => {
      document.body.innerHTML = `
        <button id="hidden" style="display:none">hidden</button>
        <button id="disabled" disabled>disabled</button>
      `;
      const page = createPage();
      const events: string[] = [];
      document
        .querySelectorAll("button")
        .forEach((button) =>
          button.addEventListener("click", () => events.push(button.id))
        );

      await expect(page.locator("#hidden").click()).rejects.toThrow(
        /Timeout 1000ms exceeded.*not visible/
      );
      await expect(page.locator("#disabled").click()).rejects.toThrow(
        /Timeout 1000ms exceeded.*not enabled/
      );
      expect(events).toEqual([]);
    });

    it("dispatches an ordered pointer/mouse prefix before one native click", async () => {
      document.body.innerHTML = "<div id=parent><button>go</button></div>";
      const page = createPage();
      const events: Array<{
        type: string;
        button: number;
        buttons: number;
        clientX: number;
        clientY: number;
        detail: number;
      }> = [];
      const button = document.querySelector("button")!;
      button.setAttribute(
        "style",
        "position: fixed; left: 10px; top: 20px; width: 100px; height: 40px"
      );
      for (const type of [
        "pointerover",
        "pointerenter",
        "mouseover",
        "mouseenter",
        "pointermove",
        "mousemove",
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ])
        button.addEventListener(type, (event) => {
          const mouse = event as MouseEvent;
          events.push({
            type,
            button: mouse.button,
            buttons: mouse.buttons,
            clientX: mouse.clientX,
            clientY: mouse.clientY,
            detail: mouse.detail,
          });
        });

      await page.locator("button").click();

      expect(events.map((event) => event.type)).toEqual([
        "pointerover",
        "pointerenter",
        "mouseover",
        "mouseenter",
        "pointermove",
        "mousemove",
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]);
      expect(events[6]).toMatchObject({ button: 0, buttons: 1, detail: 0 });
      expect(events[7]).toMatchObject({
        button: 0,
        buttons: 1,
        clientX: 60,
        clientY: 40,
        detail: 1,
      });
      expect(events[8]).toMatchObject({ button: 0, buttons: 0, detail: 0 });
      expect(events[9]).toMatchObject({ button: 0, buttons: 0, detail: 1 });
      expect(events[10]).toMatchObject({
        button: 0,
        buttons: 0,
        clientX: 60,
        clientY: 40,
        detail: 1,
      });
    });

    it("runs Page and Locator click trial checks without dispatching clicks", async () => {
      document.body.innerHTML = `
        <button id=button style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px">go</button>
        <button id=disabled disabled style="position: fixed; left: 10px; top: 80px; width: 100px; height: 40px">no</button>
      `;
      const page = createPage();
      let clicks = 0;
      document
        .querySelector("#button")!
        .addEventListener("click", () => clicks++);

      await page.click("#button", { trial: true });
      await page.locator("#button").click({ trial: true });

      expect(clicks).toBe(0);
      await expect(page.click("#disabled", { trial: true })).rejects.toThrow(
        /not enabled/
      );
      await expect(
        page.locator("#disabled").click({ trial: true })
      ).rejects.toThrow(/not enabled/);
    });

    it("doubly clicks through the shared action path with native activation", async () => {
      document.body.innerHTML = `
        <button id=button style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px">go</button>
        <input id=checkbox type=checkbox />
      `;
      const page = createPage();
      const button = document.querySelector("#button")!;
      const checkbox = document.querySelector("#checkbox") as HTMLInputElement;
      const events: Array<{ type: string; detail: number }> = [];
      let activations = 0;
      let changes = 0;
      for (const type of ["mousedown", "mouseup", "click", "dblclick"])
        button.addEventListener(type, (event) => {
          events.push({ type, detail: (event as MouseEvent).detail });
        });
      button.addEventListener("click", () => activations++);
      checkbox.addEventListener("change", () => changes++);

      await page.locator("#button").dblclick();
      expect(events.map((event) => event.type)).toEqual([
        "mousedown",
        "mouseup",
        "click",
        "mousedown",
        "mouseup",
        "click",
        "dblclick",
      ]);
      expect(events.filter((event) => event.type === "mousedown")).toEqual([
        { type: "mousedown", detail: 1 },
        { type: "mousedown", detail: 2 },
      ]);
      expect(events.filter((event) => event.type === "click")).toEqual([
        { type: "click", detail: 1 },
        { type: "click", detail: 2 },
      ]);
      expect(events.at(-1)).toEqual({ type: "dblclick", detail: 2 });
      expect(activations).toBe(2);

      await page.locator("#checkbox").dblclick();
      expect(checkbox.checked).toBe(false);
      expect(changes).toBe(2);
      checkbox.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      await page.locator("#checkbox").click();
      expect(checkbox.checked).toBe(false);
      expect(changes).toBe(2);
      await page.locator("#button").click();
      expect(activations).toBe(3);
      await expect(
        page.locator("#button").dblclick({ force: true } as any)
      ).rejects.toThrow("unsupported Playwright option(s): force");
      await expect(
        page.locator("#button").dblclick({ trial: "yes" } as any)
      ).rejects.toThrow("trial must be a boolean");
      await expect(
        page.locator("#button").dblclick({
          position: { x: Infinity, y: 0 },
        } as any)
      ).rejects.toThrow("position must have finite x and y numbers");
      expect(activations).toBe(3);
    });

    it("dispatches initialized events through the pinned InjectedScript", async () => {
      document.body.innerHTML =
        "<div id=parent><button id=button>go</button></div>";
      const page = createPage();
      const button = document.querySelector("#button")!;
      const parent = document.querySelector("#parent")!;
      const events: Array<{
        target: string;
        detail: number;
        clientX: number;
      }> = [];
      button.addEventListener("click", (event) => {
        const mouse = event as MouseEvent;
        events.push({
          target: "button",
          detail: mouse.detail,
          clientX: mouse.clientX,
        });
        event.preventDefault();
      });
      parent.addEventListener("click", (event) => {
        const mouse = event as MouseEvent;
        events.push({
          target: "parent",
          detail: mouse.detail,
          clientX: mouse.clientX,
        });
        expect(event.defaultPrevented).toBe(true);
      });

      await page.locator("#button").dispatchEvent("click", {
        clientX: 7,
        detail: 3,
      });
      await page.dispatchEvent("#button", "click", {
        clientX: 11,
        detail: 5,
      });
      expect(events).toEqual([
        { target: "button", detail: 3, clientX: 7 },
        { target: "parent", detail: 3, clientX: 7 },
        { target: "button", detail: 5, clientX: 11 },
        { target: "parent", detail: 5, clientX: 11 },
      ]);
      await expect(
        page
          .locator("#button")
          .dispatchEvent("click", {}, { force: true } as any)
      ).rejects.toThrow("unsupported Playwright option(s): force");
      expect(events).toHaveLength(4);

      document.body.innerHTML =
        "<button class=item>first</button><button class=item>second</button>";
      const dispatched: string[] = [];
      document
        .querySelector(".item")!
        .addEventListener("click", () => dispatched.push("first"));
      await page.dispatchEvent(".item", "click");
      expect(dispatched).toEqual(["first"]);
      await expect(
        page.dispatchEvent(".item", "click", {}, { strict: true })
      ).rejects.toThrow("strict mode violation");
      expect(dispatched).toEqual(["first"]);
    });

    it("does not bubble enter events and suppresses compatibility mouse events after canceled pointerdown", async () => {
      document.body.innerHTML = "<div id=parent><button>go</button></div>";
      const page = createPage();
      const parent = document.querySelector("#parent")!;
      const button = document.querySelector("button")!;
      button.setAttribute(
        "style",
        "position: fixed; left: 10px; top: 20px; width: 100px; height: 40px"
      );
      const propagated: string[] = [];
      const targetEvents: string[] = [];
      for (const type of [
        "pointerover",
        "pointerenter",
        "mouseover",
        "mouseenter",
      ])
        parent.addEventListener(type, () => propagated.push(type));
      button.addEventListener("pointerdown", (event) => {
        targetEvents.push("pointerdown");
        event.preventDefault();
      });
      for (const type of ["mousedown", "mouseup", "focus", "click"])
        button.addEventListener(type, () => targetEvents.push(type));

      await page.locator("button").click();

      expect(propagated).toEqual(["pointerover", "mouseover"]);
      expect(targetEvents).toEqual(["pointerdown", "click"]);
      expect(document.activeElement).not.toBe(button);
    });

    it("fills text inputs, textareas, and contenteditables through InjectedScript", async () => {
      document.body.innerHTML = `
        <input id="input" type="text" value="old" />
        <textarea id="textarea">old</textarea>
        <div id="editable" contenteditable>old</div>
      `;
      const page = createPage();
      const inputEvents: string[] = [];
      for (const element of document.querySelectorAll("input, textarea, div"))
        element.addEventListener("input", () => inputEvents.push(element.id));

      await page.locator("#input").fill("new input");
      await page.locator("#textarea").fill("new textarea");
      await page.locator("#editable").fill("new editable");

      expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
        "new input"
      );
      expect(
        (document.querySelector("#textarea") as HTMLTextAreaElement).value
      ).toBe("new textarea");
      expect(document.querySelector("#editable")!.textContent).toBe(
        "new editable"
      );
      expect(inputEvents).toEqual(["input", "textarea", "editable"]);
    });

    it("fills number inputs through the pinned needsinput path", async () => {
      document.body.innerHTML =
        '<input id="number" type="number" value="123" />';
      const page = createPage();
      const number = document.querySelector("#number") as HTMLInputElement;
      const events: string[] = [];
      for (const type of ["input", "change"])
        number.addEventListener(type, () => events.push(type));

      await page.fill("#number", "42");
      expect(number.value).toBe("42");
      await page.fill("#number", "-10e5");
      expect(number.value).toBe("-10e5");
      await page.fill("#number", "");

      expect(number.value).toBe("");
      expect(events).toEqual(["input", "input", "input"]);
    });

    it("fills, replaces, and clears email inputs without using selection APIs", async () => {
      document.body.innerHTML =
        '<input id="email" type="email" value="before@example.test" />';
      const page = createPage();
      const email = document.querySelector("#email") as HTMLInputElement;
      const events: string[] = [];
      email.addEventListener("input", () => events.push(email.value));

      await page.fill("#email", "first@example.test");
      await page.locator("#email").fill("second@example.test");
      await page.fill("#email", "");

      expect(email.value).toBe("");
      expect(events).toEqual(["first@example.test", "second@example.test", ""]);
    });

    it("uses InjectedScript input-type validation and editability checks for fill", async () => {
      document.body.innerHTML = `
        <input id="checkbox" type="checkbox" />
        <input id="disabled" disabled />
        <input id="readonly" readonly value="before" />
      `;
      const page = createPage();

      await expect(page.locator("#checkbox").fill("x")).rejects.toThrow(
        /cannot be filled/
      );
      await expect(page.locator("#disabled").fill("x")).rejects.toThrow(
        /not enabled/
      );
      await expect(page.locator("#readonly").fill("x")).rejects.toThrow(
        /not editable/
      );
      expect(
        (document.querySelector("#readonly") as HTMLInputElement).value
      ).toBe("before");
    });

    it("presses text, Enter, modifiers, and Space with Playwright-like key details", async () => {
      document.body.innerHTML = `
        <form><input id="input" type="text" /></form>
        <textarea id="textarea"></textarea>
        <button id="button" type="button">activate</button>
      `;
      const page = createPage();
      const form = document.querySelector("form")!;
      let submitted = 0;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitted++;
      });
      const events: Array<{
        code: string;
        ctrlKey: boolean;
        key: string;
        shiftKey: boolean;
        type: string;
      }> = [];
      for (const type of ["keydown", "keyup"])
        document.querySelector("#input")!.addEventListener(type, (event) => {
          const key = event as KeyboardEvent;
          events.push({
            code: key.code,
            ctrlKey: key.ctrlKey,
            key: key.key,
            shiftKey: key.shiftKey,
            type: key.type,
          });
        });
      let activations = 0;
      document
        .querySelector("#button")!
        .addEventListener("click", () => activations++);

      await page.locator("#input").press("h");
      await page.locator("#input").press("Shift+i");
      await page.locator("#input").press("Control+Shift+1");
      await page.locator("#input").press("Control+a");
      await page.locator("#input").press("Enter");
      await page.locator("#textarea").press("Enter");
      await page.locator("#button").press("Space");

      expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
        "hi"
      );
      expect(
        (document.querySelector("#input") as HTMLInputElement).selectionStart
      ).toBe(0);
      expect(
        (document.querySelector("#input") as HTMLInputElement).selectionEnd
      ).toBe(2);
      expect(submitted).toBe(1);
      expect(activations).toBe(1);
      expect(
        (document.querySelector("#textarea") as HTMLTextAreaElement).value
      ).toBe("\n");
      expect(events).toContainEqual({
        code: "Digit1",
        ctrlKey: true,
        key: "1",
        shiftKey: true,
        type: "keydown",
      });
      expect(events).toContainEqual({
        code: "ControlLeft",
        ctrlKey: true,
        key: "Control",
        shiftKey: false,
        type: "keydown",
      });
      expect(events).toContainEqual({
        code: "ShiftLeft",
        ctrlKey: true,
        key: "Shift",
        shiftKey: false,
        type: "keyup",
      });
      expect(events).toContainEqual({
        code: "ControlLeft",
        ctrlKey: false,
        key: "Control",
        shiftKey: false,
        type: "keyup",
      });
      await expect(page.locator("#input").press("NotARealKey")).rejects.toThrow(
        'Unknown key: "NotARealKey"'
      );
      await page.locator("#input").press("ArrowLeft");
    });

    it("keeps final modifiers active for keydown and removes them before keyup", async () => {
      document.body.innerHTML = "<input />";
      const page = createPage();
      const events: Array<{
        key: string;
        ctrlKey: boolean;
        shiftKey: boolean;
        type: string;
      }> = [];
      const input = document.querySelector("input")!;
      for (const type of ["keydown", "keyup"])
        input.addEventListener(type, (event) => {
          const key = event as KeyboardEvent;
          events.push({
            key: key.key,
            ctrlKey: key.ctrlKey,
            shiftKey: key.shiftKey,
            type: key.type,
          });
        });

      await page.locator("input").press("Shift");
      await page.locator("input").press("Control+Shift");

      expect(events).toEqual([
        { key: "Shift", ctrlKey: false, shiftKey: true, type: "keydown" },
        { key: "Shift", ctrlKey: false, shiftKey: false, type: "keyup" },
        { key: "Control", ctrlKey: true, shiftKey: false, type: "keydown" },
        { key: "Shift", ctrlKey: true, shiftKey: true, type: "keydown" },
        { key: "Shift", ctrlKey: true, shiftKey: false, type: "keyup" },
        { key: "Control", ctrlKey: false, shiftKey: false, type: "keyup" },
      ]);
    });

    it("applies selection on keydown and Space activation on keyup", async () => {
      document.body.innerHTML = '<input value="abc" /><button>go</button>';
      const page = createPage();
      const input = document.querySelector("input") as HTMLInputElement;
      const button = document.querySelector("button")!;
      input.setSelectionRange(3, 3);
      let selectionAtKeyup: [number | null, number | null] | undefined;
      let clicksAtKeyup = -1;
      let clicks = 0;
      input.addEventListener("keyup", () => {
        selectionAtKeyup = [input.selectionStart, input.selectionEnd];
      });
      button.addEventListener("keyup", () => (clicksAtKeyup = clicks));
      button.addEventListener("click", () => clicks++);

      await page.locator("input").press("Control+a");
      await page.locator("button").press("Space");

      expect(selectionAtKeyup).toEqual([0, 3]);
      expect(clicksAtKeyup).toBe(0);
      expect(clicks).toBe(1);
    });

    it("does not activate a newly focused button during Space keydown or keyup", async () => {
      document.body.innerHTML =
        "<button id=keydown-first>first</button><button id=keydown-second>second</button>";
      const page = createPage();
      const keydownFirst = document.querySelector(
        "#keydown-first"
      ) as HTMLButtonElement;
      const keydownSecond = document.querySelector(
        "#keydown-second"
      ) as HTMLButtonElement;
      let keydownClicks = 0;
      keydownFirst.addEventListener("click", () => keydownClicks++);
      keydownSecond.addEventListener("click", () => keydownClicks++);
      keydownFirst.addEventListener("keydown", () => keydownSecond.focus());

      keydownFirst.focus();
      await page.keyboard.press("Space");
      expect(keydownClicks).toBe(0);

      document.body.innerHTML =
        "<button id=keyup-first>first</button><button id=keyup-second>second</button>";
      const keyupFirst = document.querySelector(
        "#keyup-first"
      ) as HTMLButtonElement;
      const keyupSecond = document.querySelector(
        "#keyup-second"
      ) as HTMLButtonElement;
      let keyupClicks = 0;
      keyupFirst.addEventListener("click", () => keyupClicks++);
      keyupSecond.addEventListener("click", () => keyupClicks++);
      keyupFirst.addEventListener("keyup", () => keyupSecond.focus());

      keyupFirst.focus();
      await page.keyboard.press("Space");
      expect(keyupClicks).toBe(0);
    });

    it("waits for keyup focus microtasks before Space activation", async () => {
      document.body.innerHTML =
        "<button id=queued-first>first</button><button id=queued-second>second</button>";
      const page = createPage();
      const queuedFirst = document.querySelector(
        "#queued-first"
      ) as HTMLButtonElement;
      const queuedSecond = document.querySelector(
        "#queued-second"
      ) as HTMLButtonElement;
      let queuedClicks = 0;
      queuedFirst.addEventListener("click", () => queuedClicks++);
      queuedSecond.addEventListener("click", () => queuedClicks++);
      queuedFirst.addEventListener("keyup", () =>
        queueMicrotask(() => queuedSecond.focus())
      );

      queuedFirst.focus();
      await page.keyboard.press("Space");
      expect(queuedClicks).toBe(0);

      document.body.innerHTML =
        "<button id=nested-first>first</button><button id=nested-second>second</button>";
      const nestedFirst = document.querySelector(
        "#nested-first"
      ) as HTMLButtonElement;
      const nestedSecond = document.querySelector(
        "#nested-second"
      ) as HTMLButtonElement;
      let nestedClicks = 0;
      nestedFirst.addEventListener("click", () => nestedClicks++);
      nestedSecond.addEventListener("click", () => nestedClicks++);
      nestedFirst.addEventListener("keyup", () =>
        queueMicrotask(() => queueMicrotask(() => nestedSecond.focus()))
      );

      nestedFirst.focus();
      await page.keyboard.press("Space");
      expect(nestedClicks).toBe(0);
    });

    it("applies Enter defaults only for supported controls", async () => {
      document.body.innerHTML = `
        <form>
          <input id=text type=text />
          <button id=button type=button>button</button>
          <input id=submit type=submit value=submit />
          <input id=checkbox type=checkbox />
          <input id=radio type=radio name=choice />
        </form>
      `;
      const page = createPage();
      const form = document.querySelector("form")!;
      let submissions = 0;
      let buttonClicks = 0;
      let submitClicks = 0;
      let checkboxClicks = 0;
      let radioClicks = 0;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submissions++;
      });
      document
        .querySelector("#button")!
        .addEventListener("click", () => buttonClicks++);
      document
        .querySelector("#submit")!
        .addEventListener("click", () => submitClicks++);
      document
        .querySelector("#checkbox")!
        .addEventListener("click", () => checkboxClicks++);
      document
        .querySelector("#radio")!
        .addEventListener("click", () => radioClicks++);

      await page.locator("#button").press("Enter");
      await page.locator("#submit").press("Enter");
      await page.locator("#text").press("Enter");
      await page.locator("#checkbox").press("Enter");
      await page.locator("#radio").press("Enter");

      expect(buttonClicks).toBe(1);
      expect(submitClicks).toBe(1);
      expect(submissions).toBe(2);
      expect(checkboxClicks).toBe(0);
      expect(radioClicks).toBe(0);
      expect(
        (document.querySelector("#checkbox") as HTMLInputElement).checked
      ).toBe(false);
      expect(
        (document.querySelector("#radio") as HTMLInputElement).checked
      ).toBe(false);
    });

    it("exposes stable page.keyboard state to the current focused element", async () => {
      document.body.innerHTML =
        "<input id=input /><textarea id=textarea></textarea>";
      const page = createPage();
      const keyboard = page.keyboard;
      const input = document.querySelector("#input") as HTMLInputElement;
      const textarea = document.querySelector(
        "#textarea"
      ) as HTMLTextAreaElement;
      const events: Array<{
        key: string;
        repeat: boolean;
        shift: boolean;
        type: string;
      }> = [];
      input.addEventListener("keydown", (event) => {
        const key = event as KeyboardEvent;
        events.push({
          key: key.key,
          repeat: key.repeat,
          shift: key.shiftKey,
          type: key.type,
        });
      });

      input.focus();
      expect(page.keyboard).toBe(keyboard);
      await keyboard.down("Shift");
      await keyboard.down("a");
      await keyboard.down("a");
      await keyboard.up("a");
      await keyboard.up("Shift");
      await keyboard.insertText("嗨");
      textarea.focus();
      await keyboard.type("ok");

      expect(input.value).toBe("aa嗨");
      expect(textarea.value).toBe("ok");
      expect(events).toContainEqual({
        key: "a",
        repeat: false,
        shift: true,
        type: "keydown",
      });
      expect(events).toContainEqual({
        key: "a",
        repeat: true,
        shift: true,
        type: "keydown",
      });
    });

    it("honors keyboard cancellation and emits beforeinput before input", async () => {
      document.body.innerHTML = "<input id=input />";
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      const events: string[] = [];
      input.focus();
      input.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "a") event.preventDefault();
      });
      input.addEventListener("keypress", (event) => {
        if ((event as KeyboardEvent).key === "b") event.preventDefault();
      });
      input.addEventListener("beforeinput", (event) => {
        events.push(`before:${(event as InputEvent).data}`);
        if ((event as InputEvent).data === "c") event.preventDefault();
      });
      input.addEventListener("input", (event) =>
        events.push(`input:${(event as InputEvent).data}`)
      );

      await page.keyboard.press("a");
      await page.keyboard.press("b");
      await page.keyboard.press("c");
      await page.keyboard.insertText("d");

      expect(input.value).toBe("d");
      expect(events).toEqual(["before:c", "before:d", "input:d"]);
    });

    it("orders keyboard chords, suppresses modified text, and replaces contenteditable selection", async () => {
      document.body.innerHTML =
        "<input id=input value=before /><div id=editor contenteditable>before</div>";
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      const editor = document.querySelector("#editor") as HTMLElement;
      const events: string[] = [];
      for (const type of ["keydown", "keyup"])
        input.addEventListener(type, (event) =>
          events.push(`${type}:${(event as KeyboardEvent).key}`)
        );

      input.focus();
      const started = Date.now();
      await page.keyboard.press("Control+Shift+a", { delay: 5 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(4);
      expect(events).toEqual([
        "keydown:Control",
        "keydown:Shift",
        "keydown:a",
        "keyup:a",
        "keyup:Shift",
        "keyup:Control",
      ]);
      expect(input.value).toBe("before");
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(6);

      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      await page.keyboard.insertText("after");
      expect(editor.textContent).toBe("after");
    });

    it("uses pinned descriptions and current focus for direct keyboard events", async () => {
      document.body.innerHTML = "<input id=first /><input id=second />";
      const page = createPage();
      const first = document.querySelector("#first") as HTMLInputElement;
      const second = document.querySelector("#second") as HTMLInputElement;
      const events: Array<Record<string, unknown>> = [];
      first.focus();
      first.addEventListener("keydown", (event) => {
        const key = event as KeyboardEvent;
        events.push({
          target: "first",
          type: key.type,
          key: key.key,
          code: key.code,
          keyCode: key.keyCode,
          which: key.which,
          location: key.location,
          composed: key.composed,
        });
        second.focus();
      });
      second.addEventListener("keyup", (event) => {
        const key = event as KeyboardEvent;
        events.push({ target: "second", type: key.type, key: key.key });
      });
      second.addEventListener("keypress", (event) => {
        const key = event as KeyboardEvent;
        events.push({
          target: "second",
          type: key.type,
          key: key.key,
          charCode: key.charCode,
          which: key.which,
        });
      });

      await page.keyboard.press("Numpad1", { delay: 1 });
      first.focus();
      await page.keyboard.press("a");

      expect(events).toContainEqual({
        target: "first",
        type: "keydown",
        key: "End",
        code: "Numpad1",
        keyCode: 35,
        which: 35,
        location: 3,
        composed: true,
      });
      expect(events).toContainEqual({
        target: "second",
        type: "keyup",
        key: "End",
      });
      expect(events).toContainEqual({
        target: "second",
        type: "keypress",
        key: "a",
        charCode: 97,
        which: 97,
      });
    });

    it("uses the current focus for each keyboard phase after nested microtasks", async () => {
      document.body.innerHTML = "<input id=first /><input id=second />";
      const page = createPage();
      const first = document.querySelector("#first") as HTMLInputElement;
      const second = document.querySelector("#second") as HTMLInputElement;
      const events: string[] = [];
      for (const input of [first, second]) {
        for (const type of [
          "keydown",
          "keypress",
          "beforeinput",
          "input",
          "keyup",
        ])
          input.addEventListener(type, () =>
            events.push(`${type}:${input.id}`)
          );
      }
      first.addEventListener("keydown", () =>
        queueMicrotask(() => queueMicrotask(() => second.focus()))
      );

      first.focus();
      await page.keyboard.press("a");

      expect(first.value).toBe("");
      expect(second.value).toBe("a");
      expect(events).toEqual([
        "keydown:first",
        "keypress:second",
        "beforeinput:second",
        "input:second",
        "keyup:second",
      ]);
    });

    it("follows focus inside nested open shadow roots", async () => {
      document.body.innerHTML = "<div id=outer></div>";
      const page = createPage();
      const outer = document.querySelector("#outer")!;
      const outerRoot = outer.attachShadow({ mode: "open" });
      const inner = document.createElement("div");
      outerRoot.append(inner);
      const innerRoot = inner.attachShadow({ mode: "open" });
      const input = document.createElement("input");
      innerRoot.append(input);

      input.focus();
      await page.keyboard.type("a");

      expect(input.value).toBe("a");
    });

    it("rechecks editability after keydown microtasks", async () => {
      document.body.innerHTML = "<input id=input />";
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      const events: string[] = [];
      for (const type of ["keydown", "keypress", "beforeinput", "input"])
        input.addEventListener(type, () => events.push(type));
      input.addEventListener("keydown", () =>
        queueMicrotask(() => queueMicrotask(() => (input.readOnly = true)))
      );

      input.focus();
      await page.keyboard.press("a");

      expect(input.value).toBe("");
      expect(events).toEqual(["keydown", "keypress"]);
    });

    it("preserves Enter input metadata through textarea insertion", async () => {
      document.body.innerHTML = "<textarea id=textarea></textarea>";
      const page = createPage();
      const textarea = document.querySelector(
        "#textarea"
      ) as HTMLTextAreaElement;
      const events: Array<{
        type: string;
        data: string | null;
        inputType: string;
      }> = [];
      for (const type of ["beforeinput", "input"])
        textarea.addEventListener(type, (event) => {
          const input = event as InputEvent;
          events.push({ type, data: input.data, inputType: input.inputType });
        });

      textarea.focus();
      await page.keyboard.press("Enter");

      expect(textarea.value).toBe("\n");
      expect(events).toEqual([
        { type: "beforeinput", data: null, inputType: "insertLineBreak" },
        { type: "input", data: null, inputType: "insertLineBreak" },
      ]);
    });

    it("routes selector presses through the shared current-focus keyboard path", async () => {
      document.body.innerHTML = "<input id=first /><input id=second />";
      const page = createPage();
      const first = document.querySelector("#first") as HTMLInputElement;
      const second = document.querySelector("#second") as HTMLInputElement;
      first.addEventListener("keydown", () => second.focus());

      await page.locator("#first").press("a");

      expect(first.value).toBe("");
      expect(second.value).toBe("a");
    });
  });

  // ── W-35: common locator query methods ─────────────────────────

  describe("common locator queries", () => {
    it("returns attributes, text, and values through matching Page and Locator methods", async () => {
      document.body.innerHTML = `
        <label id=label for=input>Input label</label>
        <input id=input value=value />
        <select id=select><option value=one>One</option><option value=two selected>Two</option></select>
        <textarea id=textarea>Text area</textarea>
        <div id=text name=value>Text content</div>
      `;
      const page = createPage();

      expect(await page.locator("#text").getAttribute("name")).toBe("value");
      expect(await page.getAttribute("#text", "missing")).toBeNull();
      expect(await page.locator("#text").textContent()).toBe("Text content");
      expect(await page.textContent("#text")).toBe("Text content");
      expect(await page.locator("#input").inputValue()).toBe("value");
      expect(await page.inputValue("#select")).toBe("two");
      expect(await page.locator("#textarea").inputValue()).toBe("Text area");
      expect(await page.locator("#label").inputValue()).toBe("value");
    });

    it("uses injected enabled, disabled, and checked state for Page and Locator", async () => {
      document.body.innerHTML = `
        <button id=disabled disabled>Disabled</button>
        <button id=enabled>Enabled</button>
        <input id=checkbox type=checkbox checked />
        <input id=radio type=radio checked />
        <input id=unchecked-radio type=radio />
      `;
      const page = createPage();

      expect(await page.locator("#disabled").isDisabled()).toBe(true);
      expect(await page.isEnabled("#disabled")).toBe(false);
      expect(await page.locator("#enabled").isEnabled()).toBe(true);
      expect(await page.isDisabled("#enabled")).toBe(false);
      expect(await page.locator("#checkbox").isChecked()).toBe(true);
      expect(await page.isChecked("#radio")).toBe(true);
      expect(await page.locator("#unchecked-radio").isChecked()).toBe(false);
    });

    it("reads checked state and geometry through a fixed ElementHandle", async () => {
      document.body.innerHTML = `
        <input id=checkbox type=checkbox checked
          style="appearance: none; border: 0; margin: 0; padding: 0; position: fixed; left: 10px; top: 20px; width: 100px; height: 40px" />
      `;
      const page = createPage();
      const handle = await page.$("#checkbox");

      expect(handle).not.toBeNull();
      expect(await handle!.isChecked()).toBe(true);
      expect(await handle!.boundingBox()).toEqual({
        x: 10,
        y: 20,
        width: 100,
        height: 40,
      });
    });

    it("returns no box for fixed handles that are detached or not rendered", async () => {
      document.body.innerHTML = `
        <div style="display: none"><span id=hidden>hidden</span></div>
        <span id=detached>detached</span>
      `;
      const page = createPage();
      const hidden = await page.$("#hidden");
      const detached = await page.$("#detached");

      expect(hidden).not.toBeNull();
      expect(detached).not.toBeNull();
      expect(await hidden!.boundingBox()).toBeNull();
      document.querySelector("#detached")!.remove();
      expect(await detached!.boundingBox()).toBeNull();
    });

    it("waits for a missing query target and honors timeout and abort", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      window.setTimeout(
        () => (document.body.innerHTML = "<div id=ready>Ready</div>"),
        25
      );

      await expect(page.locator("#ready").textContent()).resolves.toBe("Ready");
      await expect(page.inputValue("#never", { timeout: 25 })).rejects.toThrow(
        /Timeout 25ms exceeded/
      );

      const controller = new AbortController();
      window.setTimeout(() => controller.abort("test abort"), 10);
      await expect(
        page.locator("#aborted").getAttribute("name", {
          signal: controller.signal,
          timeout: 100,
        })
      ).rejects.toThrow(/Query was aborted: test abort/);
    });

    it("waits past one second when query timeout is omitted", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      window.setTimeout(
        () => (document.body.innerHTML = "<div id=late>Late</div>"),
        1_025
      );

      await expect(page.locator("#late").textContent()).resolves.toBe("Late");
    });

    it("uses Page first-match semantics unless strict and Locator strictness always", async () => {
      document.body.innerHTML = "<div id=first></div><div id=second></div>";
      const page = createPage();

      await expect(page.getAttribute("div", "id")).resolves.toBe("first");
      await expect(
        page.getAttribute("div", "id", { strict: true })
      ).rejects.toThrow(/strict mode violation/);
      await expect(page.locator("div").getAttribute("id")).rejects.toThrow(
        /strict mode violation/
      );
    });

    it("rejects invalid input-value and checked targets without retrying", async () => {
      document.body.innerHTML = "<div></div><input type=text />";
      const page = createPage();

      await expect(page.locator("div").inputValue()).rejects.toThrow(
        "Node is not an <input>, <textarea> or <select> element"
      );
      await expect(page.isChecked("div")).rejects.toThrow(
        "Not a checkbox or radio button"
      );
      await expect(page.locator("input").isChecked()).rejects.toThrow(
        "Not a checkbox or radio button"
      );
    });

    it("returns strict inner text and HTML plus all matching text values", async () => {
      document.body.innerHTML = `
        <div class=item><span>One</span></div>
        <div class=item><span>Two</span></div>
        <svg id=svg><text>Vector</text></svg>
      `;
      const page = createPage();

      expect(await page.locator(".item").allTextContents()).toEqual([
        "One",
        "Two",
      ]);
      expect(await page.locator(".item").allInnerTexts()).toEqual([
        "One",
        "Two",
      ]);
      expect(await page.locator(".item").first().innerHTML()).toBe(
        "<span>One</span>"
      );
      expect(await page.locator(".item").last().innerText()).toBe("Two");
      await expect(page.locator(".item").innerText()).rejects.toThrow(
        /strict mode violation/
      );
      await expect(page.locator("#svg").innerText()).rejects.toThrow(
        "Node is not an HTMLElement"
      );
    });

    it("reports editable, visible, and hidden state using InjectedScript", async () => {
      document.body.innerHTML = `
        <input id=editable />
        <input id=readonly readonly />
        <div id=contenteditable contenteditable=true></div>
        <div id=hidden hidden></div>
      `;
      const page = createPage();

      expect(await page.locator("#editable").isEditable()).toBe(true);
      expect(await page.locator("#readonly").isEditable()).toBe(false);
      expect(await page.locator("#contenteditable").isEditable()).toBe(true);
      expect(await page.locator("#editable").isVisible()).toBe(true);
      expect(await page.locator("#editable").isHidden()).toBe(false);
      expect(await page.locator("#hidden").isVisible()).toBe(false);
      expect(await page.locator("#hidden").isHidden()).toBe(true);
      expect(await page.locator("#missing").isVisible()).toBe(false);
      expect(await page.locator("#missing").isHidden()).toBe(true);
    });

    it("returns a visible element's browser bounds and null when hidden", async () => {
      document.body.innerHTML = `<div id=visible></div><div id=hidden hidden></div>`;
      const visible = document.querySelector("#visible")!;
      visible.getBoundingClientRect = () =>
        ({ x: 10, y: 20, width: 30, height: 40 }) as DOMRect;
      const page = createPage();

      expect(await page.locator("#visible").boundingBox()).toEqual({
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      });
      expect(await page.locator("#hidden").boundingBox()).toBeNull();
    });

    it("preserves a rendered zero-size bounding box", async () => {
      document.body.innerHTML = `<div id=zero></div>`;
      const zero = document.querySelector("#zero")!;
      zero.getBoundingClientRect = () =>
        ({ x: 0, y: 2020, width: 1280, height: 0 }) as DOMRect;
      zero.getClientRects = () => [zero.getBoundingClientRect()] as any;
      const page = createPage();

      await expect(page.locator("#zero").boundingBox()).resolves.toEqual({
        x: 0,
        y: 2020,
        width: 1280,
        height: 0,
      });
    });

    it("retains the original implicit XPath in selector errors", async () => {
      const page = createPage();
      const selector = "//*[contains(@Class, 'foo']";
      const error = await page
        .locator(selector)
        .isVisible()
        .catch((error) => error);
      const expectedSelector = selector.replaceAll("'", "\\'");

      expect(error.message).toContain(expectedSelector);
      expect(error.message).not.toContain(`.${expectedSelector}`);
    });

    it("marks locator query timeouts and includes the locator call log", async () => {
      document.body.innerHTML = "";
      const page = createPage();
      const error = await page
        .locator("span")
        .innerText({ timeout: 1 })
        .catch((error) => error);

      expect(error.name).toBe("TimeoutError");
      expect(error[ADAPTER_TIMEOUT_ERROR]).toBe(true);
      expect(error.message).toContain("Timeout 1ms exceeded.");
      expect(error.message).toContain("waiting for locator('span')");
    });
  });

  describe("browser-native locator conveniences", () => {
    it("focuses, blurs, clears, and types sequentially", async () => {
      document.body.innerHTML = `<input id=input value=before />`;
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      const events: string[] = [];
      input.addEventListener("focus", () => events.push("focus"));
      input.addEventListener("blur", () => events.push("blur"));

      await page.locator("#input").focus();
      expect(document.activeElement).toBe(input);
      await page.locator("#input").clear();
      expect(input.value).toBe("");
      await page.locator("#input").pressSequentially("abc");
      expect(input.value).toBe("abc");
      await page.locator("#input").blur();
      expect(document.activeElement).not.toBe(input);
      expect(events).toEqual(["focus", "blur"]);
    });

    it("types text through a strict locator with delay and an explicit zero timeout", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;

      await page.locator("#input").type("abc", { delay: 5, timeout: 0 });

      expect(input.value).toBe("abc");
    });

    it("types literal spaces and arbitrary Unicode without relaxing press key validation", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;

      await page.locator("#input").pressSequentially("hello world café 😀");

      expect(input.value).toBe("hello world café 😀");
      await expect(page.locator("#input").press("NotAKey")).rejects.toThrow(
        'Unknown key: "NotAKey"'
      );
    });

    it("keeps Locator.type strict", async () => {
      document.body.innerHTML = `<input /><input />`;
      const page = createPage();

      await expect(page.locator("input").type("x")).rejects.toThrow(
        /strict mode violation/
      );
    });

    it("uses one deadline for pressSequentially typing without a late character", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;

      await expect(
        page
          .locator("#input")
          .pressSequentially("ab", { delay: 100, timeout: 20 })
      ).rejects.toThrow("Timeout 20ms exceeded");
      await page.waitForTimeout(120);

      expect(input.value).toBe("a");

      input.value = "";
      await page
        .locator("#input")
        .pressSequentially("ab", { delay: 5, timeout: 0 });
      expect(input.value).toBe("ab");
    });

    it("does not insert after a selector press deadline expires during a keyboard phase", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      input.addEventListener("keydown", () =>
        queueMicrotask(() => {
          const deadline = Date.now() + 40;
          while (Date.now() < deadline) {
            // Keep the keyboard continuation behind a main-thread task.
          }
        })
      );

      await expect(
        page.locator("#input").press("a", { timeout: 10 })
      ).rejects.toThrow("Timeout 10ms exceeded");
      expect(input.value).toBe("");
    });

    it.each(["default", "explicit"] as const)(
      "waits with %s zero timeout, then stops querying",
      async (timeoutSource) => {
        document.body.innerHTML = "";
        const page = createPage();
        if (timeoutSource === "default") page.setDefaultTimeout(0);
        const resolveLocatorElement = (page as any).resolveLocatorElement.bind(
          page
        );
        let queries = 0;
        (page as any).resolveLocatorElement = (...args: any[]) => {
          queries++;
          return resolveLocatorElement(...args);
        };
        window.setTimeout(() => {
          document.body.innerHTML = '<div id="later">ready</div>';
        }, 10);

        await page
          .locator("#later")
          .waitFor(timeoutSource === "explicit" ? { timeout: 0 } : undefined);
        const settledQueries = queries;
        await page.waitForTimeout(75);

        expect(settledQueries).toBeGreaterThan(1);
        expect(queries).toBe(settledQueries);
      }
    );

    it("keeps locator waitFor strict", async () => {
      document.body.innerHTML = `<div class=duplicate></div><div class=duplicate></div>`;
      const page = createPage();

      await expect(page.locator(".duplicate").waitFor()).rejects.toThrow(
        /strict mode violation/
      );
    });

    it("checks and unchecks controls with Playwright's radio restriction", async () => {
      document.body.innerHTML = `
        <input id=checkbox type=checkbox />
        <input id=radio type=radio />
      `;
      const page = createPage();
      const checkbox = document.querySelector("#checkbox") as HTMLInputElement;

      await page.locator("#checkbox").check();
      expect(checkbox.checked).toBe(true);
      await page.locator("#checkbox").setChecked(false);
      expect(checkbox.checked).toBe(false);
      await page.locator("#radio").check();
      await expect(page.locator("#radio").uncheck()).rejects.toThrow(
        "Cannot uncheck radio button"
      );
    });

    it("checks labels at a requested position and runs trial checks without mutating", async () => {
      document.body.innerHTML = `
        <label for=checkbox style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px"><span id=hit style="display:block; position:absolute; inset:0">Click me</span></label>
        <input id=checkbox type=checkbox />
      `;
      const page = createPage();
      const checkbox = document.querySelector("#checkbox") as HTMLInputElement;
      const label = document.querySelector("label")!;
      const hit = document.querySelector("#hit")!;
      const points: Array<{ x: number; y: number }> = [];
      const targets: string[] = [];
      label.addEventListener("pointerdown", (event) =>
        points.push({ x: event.clientX, y: event.clientY })
      );
      label.addEventListener("pointerdown", (event) =>
        targets.push((event.target as Element).id)
      );

      await page.check("#checkbox", { trial: true });
      expect(checkbox.checked).toBe(false);
      await page.locator("#checkbox").setChecked(true, { trial: true });
      expect(checkbox.checked).toBe(false);

      await page.check("label", { position: { x: 7, y: 9 } });
      expect(checkbox.checked).toBe(true);
      expect(points).toEqual([{ x: 17, y: 29 }]);
      expect(targets).toEqual([hit.id]);

      await page.locator("#checkbox").uncheck({ trial: true });
      expect(checkbox.checked).toBe(true);
      await expect(
        page.locator("#checkbox").check({ trial: "yes" } as any)
      ).rejects.toThrow("trial must be a boolean");
      await expect(
        page.locator("#checkbox").check({
          position: { x: Infinity, y: 0 },
        } as any)
      ).rejects.toThrow("position must have finite x and y numbers");
    });

    it("preserves strictness and does not click an already-correct control", async () => {
      document.body.innerHTML = `
        <input id=checkbox type=checkbox checked />
        <button>First</button><button>Second</button>
      `;
      const page = createPage();
      const checkbox = document.querySelector("#checkbox")!;
      let clicks = 0;
      checkbox.addEventListener("click", () => clicks++);

      await page.locator("#checkbox").check();
      expect(clicks).toBe(0);
      await expect(page.locator("button").focus()).rejects.toThrow(
        "strict mode violation"
      );
    });

    it("selects options through InjectedScript and dispatches input and change", async () => {
      document.body.innerHTML = `
        <select id=select multiple>
          <option value=one>One</option>
          <option value=two>Two</option>
          <option value=three>Three</option>
        </select>
      `;
      const page = createPage();
      const select = document.querySelector("#select") as HTMLSelectElement;
      const events: string[] = [];
      select.addEventListener("input", () => events.push("input"));
      select.addEventListener("change", () => events.push("change"));

      await expect(
        page
          .locator("#select")
          .selectOption([{ value: "one" }, { label: "Three" }])
      ).resolves.toEqual(["one", "three"]);
      expect(
        Array.from(select.selectedOptions, (option) => option.value)
      ).toEqual(["one", "three"]);
      expect(events).toEqual(["input", "change"]);
      await expect(
        page.locator("#select").selectOption("missing", { timeout: 20 })
      ).rejects.toThrow(/Timeout 20ms exceeded.*Options not found/);

      await expect(page.locator("#select").selectOption(null)).resolves.toEqual(
        []
      );
      expect(select.selectedOptions).toHaveLength(0);
    });

    it("retries selectOption until matching options are inserted", async () => {
      document.body.innerHTML = `<select id=select></select>`;
      const page = createPage();
      const select = document.querySelector("#select") as HTMLSelectElement;
      window.setTimeout(() => {
        const option = document.createElement("option");
        option.value = "later";
        select.append(option);
      }, 15);

      await expect(
        page.locator("#select").selectOption("later", { timeout: 200 })
      ).resolves.toEqual(["later"]);
    });

    it("retries selectOption after a disabled matching option becomes enabled", async () => {
      document.body.innerHTML = `
        <select id=select><option value=later disabled>Later</option></select>
      `;
      const page = createPage();
      const option = document.querySelector("option") as HTMLOptionElement;
      const injected = (page as any).actionableInjected;
      const selectOptions = injected.selectOptions.bind(injected);
      let attempts = 0;
      const selectOptionsSpy = vi
        .spyOn(injected, "selectOptions")
        .mockImplementation((...args: any[]) => {
          attempts++;
          const result = selectOptions(...args);
          if (attempts === 1) option.disabled = false;
          return result;
        });

      try {
        await expect(
          page.locator("#select").selectOption("later", { timeout: 200 })
        ).resolves.toEqual(["later"]);
        expect(attempts).toBeGreaterThanOrEqual(2);
      } finally {
        selectOptionsSpy.mockRestore();
      }
    });

    it("re-resolves a select after its target detaches", async () => {
      document.body.innerHTML = `
        <select id=select><option value=one>One</option></select>
      `;
      const page = createPage();
      const select = document.querySelector("#select") as HTMLSelectElement;
      const injected = (page as any).actionableInjected;
      const selectOptions = injected.selectOptions.bind(injected);
      let attempts = 0;
      const selectOptionsSpy = vi
        .spyOn(injected, "selectOptions")
        .mockImplementation((...args: any[]) => {
          attempts++;
          if (attempts === 1) {
            const replacement = document.createElement("select");
            replacement.id = "select";
            replacement.innerHTML = `<option value=one>One</option>`;
            select.replaceWith(replacement);
            return "error:notconnected";
          }
          return selectOptions(...args);
        });

      try {
        await expect(
          page.locator("#select").selectOption("one", { timeout: 200 })
        ).resolves.toEqual(["one"]);
        expect(attempts).toBeGreaterThanOrEqual(2);
      } finally {
        selectOptionsSpy.mockRestore();
      }
    });

    it("times out missing select options after the configured wait", async () => {
      document.body.innerHTML = `<select id=select></select>`;
      const page = createPage();
      const startedAt = Date.now();
      await expect(
        page.locator("#select").selectOption("missing", { timeout: 20 })
      ).rejects.toThrow(/Timeout 20ms exceeded/);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
    });

    it("selects text, scrolls, and emits hover events", async () => {
      document.body.innerHTML = `<input id=input value=hello /><button id=button>Hover</button>`;
      const page = createPage();
      const input = document.querySelector("#input") as HTMLInputElement;
      const button = document.querySelector("#button") as HTMLButtonElement;
      const scrolls: ScrollIntoViewOptions[] = [];
      button.scrollIntoView = (options) =>
        scrolls.push(typeof options === "object" ? options : {});
      const events: string[] = [];
      button.addEventListener("pointerover", () => events.push("pointerover"));
      button.addEventListener("mouseover", () => events.push("mouseover"));

      await page.locator("#input").selectText();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(5);
      await page.locator("#button").scrollIntoViewIfNeeded();
      await page.locator("#button").hover();
      expect(scrolls.length).toBeGreaterThan(0);
      expect(events).toEqual(["pointerover", "mouseover"]);
    });

    it("uses the native scrollIntoViewIfNeeded primitive when available", async () => {
      document.body.innerHTML = `<button id=button>Scroll</button>`;
      const page = createPage();
      const button = document.querySelector("#button") as HTMLButtonElement & {
        scrollIntoViewIfNeeded?: () => void;
      };
      const nativeScroll = vi.fn();
      button.scrollIntoViewIfNeeded = nativeScroll;
      button.scrollIntoView = vi.fn();

      await page.locator("#button").scrollIntoViewIfNeeded();

      expect(nativeScroll).toHaveBeenCalledOnce();
      expect(button.scrollIntoView).not.toHaveBeenCalled();
    });

    it("rejects action options whose semantics are not implemented", async () => {
      document.body.innerHTML = `<input id=input />`;
      const page = createPage();

      await expect(
        page.locator("#input").check({ force: true })
      ).rejects.toThrow(/unsupported Playwright option/);
      await expect(
        page
          .locator("#input")
          .pressSequentially("a", { delay: 1, force: true } as any)
      ).rejects.toThrow(/unsupported Playwright option/);
    });
  });

  // ── AC5: resolveOne removed ───────────────────────────────────

  it("page does not expose resolveOne", () => {
    const page = createPage();
    expect((page as any).resolveOne).toBeUndefined();
  });

  // ── getByRole full options ────────────────────────────────────

  describe("getByRole options", () => {
    it("supports name option", async () => {
      document.body.innerHTML = `
        <button>Save</button>
        <button>Cancel</button>
      `;
      const page = createPage();
      const save = page.getByRole("button", { name: "Save" });
      expect(await save.count()).toBe(1);
    });

    it("supports checked option", async () => {
      document.body.innerHTML = `
        <input type="checkbox" checked aria-label="agree" />
        <input type="checkbox" aria-label="other" />
      `;
      const page = createPage();
      const checked = page.getByRole("checkbox", { checked: true });
      expect(await checked.count()).toBe(1);
    });

    it("supports description option via aria-describedby", async () => {
      document.body.innerHTML = `
        <button aria-describedby="desc1">OK</button>
        <span id="desc1">Confirms the action</span>
        <button>Cancel</button>
      `;
      const page = createPage();
      const btn = page.getByRole("button", {
        description: "Confirms the action",
      });
      expect(await btn.count()).toBe(1);
    });

    it("Locator.getByRole supports full options including pressed", async () => {
      document.body.innerHTML = `
        <div>
          <button aria-pressed="true">Bold</button>
          <button>Italic</button>
        </div>
      `;
      const page = createPage();
      const pressed = page
        .locator("div")
        .getByRole("button", { pressed: true });
      expect(await pressed.count()).toBe(1);
    });
  });

  // ── first / last / nth ────────────────────────────────────────

  describe("first/last/nth", () => {
    it("first() returns the first match", async () => {
      document.body.innerHTML = "<ul><li>A</li><li>B</li><li>C</li></ul>";
      const page = createPage();
      expect(await page.locator("li").first().count()).toBe(1);
    });

    it("last() returns the last match", async () => {
      document.body.innerHTML = "<ul><li>A</li><li>B</li><li>C</li></ul>";
      const page = createPage();
      expect(await page.locator("li").last().count()).toBe(1);
    });
  });

  // ── Native document setup ─────────────────────────────────────

  describe("content after native document setup", () => {
    let iframe: HTMLIFrameElement;

    function setupDedicatedPage(html: string) {
      iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      const win = iframe.contentWindow! as Window & typeof globalThis;
      win.document.open();
      win.document.write(html);
      win.document.close();
      return new PageImpl(win);
    }

    afterEach(() => {
      iframe?.remove();
    });

    it("serializes content from native fixture setup", async () => {
      const page = setupDedicatedPage("<!DOCTYPE html><div>hello</div>");
      expect(await page.content()).toBe(
        "<!DOCTYPE html><html><head></head><body><div>hello</div></body></html>"
      );
    });

    it("keeps the controlled document as the main frame facade", () => {
      const page = setupDedicatedPage("<p>hello</p>");
      expect(page.mainFrame()).toBe(page);
    });
  });

  // ── W-33: locator expectation orchestration ───────────────────

  describe("locator expectations", () => {
    const expectedText = (value: string) => [
      { string: value, normalizeWhiteSpace: true },
    ];

    it("retries InjectedScript checks until the expectation succeeds", async () => {
      document.body.innerHTML = '<div id="target">before</div>';
      const page = createPage();
      window.setTimeout(() => {
        document.getElementById("target")!.textContent = "after";
      }, 25);

      const result = await (page.locator("#target") as any)._expect(
        "to.have.text",
        { expectedText: expectedText("after"), timeout: 200 }
      );

      expect(result.matches).toBe(true);
      expect(result.timedOut).toBeUndefined();
    });

    it("parses ARIA matcher templates before invoking InjectedScript", async () => {
      document.body.innerHTML = "<h1>Accessible title</h1>";
      const page = createPage();

      const result = await (page.locator("body") as any)._expect(
        "to.match.aria",
        {
          expectedValue: '- heading "Accessible title" [level=1]',
          timeout: 40,
        }
      );

      expect(result).toMatchObject({ matches: true });
      expect(result.timedOut).toBeUndefined();
    });

    it("reports a positive missing-element expectation as a timeout", async () => {
      const page = createPage();

      const result = await (page.locator("#missing") as any)._expect(
        "to.have.text",
        { expectedText: expectedText("expected"), timeout: 40 }
      );

      expect(result).toMatchObject({
        matches: false,
        timedOut: true,
        errorMessage: "Error: element(s) not found",
      });
      expect(result.log).toEqual(['waiting for locator("#missing")']);
    });

    it("allows a missing locator to satisfy a negated visible expectation", async () => {
      const page = createPage();

      const result = await (page.locator("#missing") as any)._expect(
        "to.be.visible",
        { isNot: true, timeout: 1 }
      );

      // Client matchers compare this with !isNot, so false is a successful
      // `expect(locator).not.toBeVisible()` result.
      expect(result).toMatchObject({ matches: false });
      expect(result.timedOut).toBeUndefined();
    });

    it("aborts a pending expectation without reporting a timeout", async () => {
      const page = createPage();
      const controller = new AbortController();
      window.setTimeout(() => controller.abort(new Error("stop it")), 10);

      const result = await (page.locator("#missing") as any)._expect(
        "to.have.text",
        {
          expectedText: expectedText("expected"),
          timeout: 200,
          signal: controller.signal,
        }
      );

      expect(result).toMatchObject({
        matches: false,
        errorMessage: "Error: The assertion was aborted: stop it",
      });
      expect(result.timedOut).toBeUndefined();
    });
  });

  // ── W-27: evaluate ───────────────────────────────────────────

  describe("evaluate", () => {
    it("evaluates a function and returns its result", async () => {
      const page = createPage();
      const result = await page.evaluate(() => 1 + 2);
      expect(result).toBe(3);
    });

    it("passes arg to the function", async () => {
      const page = createPage();
      const result = await page.evaluate((n: number) => n * 3, 7);
      expect(result).toBe(21);
    });

    it("evaluates a string expression (isFunction=false)", async () => {
      const page = createPage();
      const result = await page.evaluate("1 + 1");
      expect(result).toBe(2);
    });

    it("evaluates a stringified function with arg (isFunction=true via bridge)", async () => {
      const page = createPage();
      const fn = (x: number) => x + 10;
      // Simulate bridge transport: String(fn) + explicit isFunction.
      const result = await (page as any)._evaluateExpression(
        String(fn),
        true,
        5
      );
      expect(result).toBe(15);
    });

    it("string + isFunction=false returns expression value, not function", async () => {
      const page = createPage();
      // '(() => 42)' as a non-function expression evaluates to the
      // function object, but isFunction=false means we return it raw.
      const result = await (page as any)._evaluateExpression("1 + 2", false);
      expect(result).toBe(3);
    });

    it("never retries after runtime exception", async () => {
      const page = createPage();
      await expect(page.evaluate("throw new Error('boom')")).rejects.toThrow(
        "boom"
      );
    });

    it("can read the DOM", async () => {
      document.body.innerHTML = "<div id='target'>hi</div>";
      const page = createPage();
      const text = await page.evaluate(
        () => document.getElementById("target")?.textContent
      );
      expect(text).toBe("hi");
    });

    it("can mutate the DOM", async () => {
      document.body.innerHTML = "<div id='mut'>before</div>";
      const page = createPage();
      await page.evaluate(() => {
        document.getElementById("mut")!.textContent = "after";
      });
      const el = document.getElementById("mut");
      expect(el?.textContent).toBe("after");
    });
  });

  // ── W-27: waitForFunction ─────────────────────────────────────

  describe("waitForFunction", () => {
    it("resolves immediately with AdapterJSHandle", async () => {
      const page = createPage();
      const handle = await (page as any).waitForFunction(() => 42);
      expect(handle).toBeInstanceOf(AdapterJSHandle);
      expect(await handle.jsonValue()).toBe(42);
    });

    it("polls until the predicate becomes truthy", async () => {
      const page = createPage();
      let counter = 0;
      const handle = await (page as any).waitForFunction(
        () => {
          counter++;
          return counter >= 3 ? counter : 0;
        },
        undefined,
        { polling: 10 }
      );
      expect(await handle.jsonValue()).toBeGreaterThanOrEqual(3);
    });

    it("rejects on timeout (including never-settling predicates)", async () => {
      const page = createPage();
      await expect(
        (page as any).waitForFunction(() => false, undefined, {
          polling: 10,
          timeout: 50,
        })
      ).rejects.toThrow(/[Tt]imeout/);
    });

    it("function reference: evals once, calls each poll", async () => {
      const page = createPage();
      let counter = 0;
      const fn = () => {
        counter++;
        return counter >= 2 ? "done" : "";
      };
      const handle = await (page as any).waitForFunction(fn, undefined, {
        polling: 10,
      });
      expect(await handle.jsonValue()).toBe("done");
    });

    it("string expression (isFunction=false) re-evaluates each poll", async () => {
      // A non-function string expression is evaled fresh each poll.
      // We can verify by using a counter on the window.
      (window as any).__wffCounter = 0;
      const page = createPage();
      const handle = await (page as any).waitForFunction(
        "++window.__wffCounter >= 3 ? window.__wffCounter : 0",
        undefined,
        { polling: 10 }
      );
      expect(await handle.jsonValue()).toBeGreaterThanOrEqual(3);
      delete (window as any).__wffCounter;
    });

    it("passes arg to the predicate", async () => {
      const page = createPage();
      const handle = await (page as any).waitForFunction(
        (x: number) => (x > 0 ? x : 0),
        5
      );
      expect(await handle.jsonValue()).toBe(5);
    });

    it("validates polling option: rejects non-positive number", async () => {
      const page = createPage();
      await expect(
        (page as any).waitForFunction(() => true, undefined, { polling: 0 })
      ).rejects.toThrow(/non-positive/);
      await expect(
        (page as any).waitForFunction(() => true, undefined, {
          polling: -1,
        })
      ).rejects.toThrow(/non-positive/);
    });

    it("validates polling option: rejects unknown string", async () => {
      const page = createPage();
      await expect(
        (page as any).waitForFunction(() => true, undefined, {
          polling: "mutation" as any,
        })
      ).rejects.toThrow(/Unknown polling/);
    });

    it("handle.dispose() returns a Promise", async () => {
      const page = createPage();
      const handle = await (page as any).waitForFunction(() => 1);
      const result = handle.dispose();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it("cleans up timers after resolve", async () => {
      const page = createPage();
      let counter = 0;
      const handle = await (page as any).waitForFunction(
        () => {
          counter++;
          return counter >= 2 ? counter : 0;
        },
        undefined,
        { polling: 10 }
      );
      const val = await handle.jsonValue();
      // Wait a bit — counter should NOT keep incrementing after resolve.
      await new Promise((r) => setTimeout(r, 50));
      expect(counter).toBe(val);
    });

    it("evaluates interval callback source in the controlled window", async () => {
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      const page = new PageImpl(
        iframe.contentWindow! as Window & typeof globalThis
      );
      const pageWindow = page.window as typeof window & {
        __waitForFunctionCalls?: number;
        builtins?: { Date: DateConstructor };
      };
      pageWindow.builtins = { Date: pageWindow.Date };

      try {
        const handle = await page._waitForFunctionExpression(
          `() => {
            window.__waitForFunctionCalls =
              (window.__waitForFunctionCalls || 0) + 1;
            return window.builtins.Date.now() &&
              window.__waitForFunctionCalls >= 2
              ? window.__waitForFunctionCalls
              : false;
          }`,
          true,
          undefined,
          { polling: 1 }
        );
        const calls = await handle.jsonValue();

        await new Promise((resolve) => pageWindow.setTimeout(resolve, 20));
        expect(pageWindow.__waitForFunctionCalls).toBe(calls);
      } finally {
        iframe.remove();
      }
    });

    it("cleans up interval polling after predicate rejection", async () => {
      const page = createPage() as unknown as PageImpl;
      (
        window as typeof window & { __waitForFunctionRejects?: number }
      ).__waitForFunctionRejects = 0;

      await expect(
        page._waitForFunctionExpression(
          `() => {
            window.__waitForFunctionRejects =
              (window.__waitForFunctionRejects || 0) + 1;
            throw new Error("stop polling");
          }`,
          true,
          undefined,
          { polling: 1 }
        )
      ).rejects.toThrow("stop polling");

      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(
        (window as typeof window & { __waitForFunctionRejects?: number })
          .__waitForFunctionRejects
      ).toBe(1);
      delete (window as typeof window & { __waitForFunctionRejects?: number })
        .__waitForFunctionRejects;
    });
  });
});
