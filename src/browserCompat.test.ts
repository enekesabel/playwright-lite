import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "./index";
import { PageImpl } from "./page";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("noWaitAfter", () => {
  it("accepts it for Page and Locator click and press without changing local dispatch", async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const page = createPage();
    const target = document.querySelector<HTMLButtonElement>("#target")!;
    const events: string[] = [];
    target.addEventListener("click", () => events.push("click"));
    target.addEventListener("keydown", () => events.push("keydown"));

    await page.click("#target", { noWaitAfter: true });
    await page.locator("#target").press("a", { noWaitAfter: false });

    expect(events).toEqual(["click", "keydown"]);
  });

  it("rejects non-booleans and keeps rejecting unknown options", async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const page = createPage();

    await expect(
      page.click("#target", { noWaitAfter: "yes" } as never)
    ).rejects.toThrow("click noWaitAfter must be a boolean");
    await expect(
      page.locator("#target").press("Enter", { noWaitAfter: 1 } as never)
    ).rejects.toThrow("press noWaitAfter must be a boolean");
    await expect(
      page.locator("#target").click({ unexpected: true } as never)
    ).rejects.toThrow("unsupported Playwright option(s): unexpected");
  });

  it("accepts it for fill and clear while validating the value", async () => {
    document.body.innerHTML = '<input id="target" value="initial" />';
    const page = createPage();
    const locator = page.locator("#target");

    await page.fill("#target", "filled", { noWaitAfter: true });
    await locator.clear({ noWaitAfter: false });

    await expect(locator.inputValue()).resolves.toBe("");
    await expect(
      page.fill("#target", "filled", { noWaitAfter: "yes" } as never)
    ).rejects.toThrow("fill noWaitAfter must be a boolean");
    await expect(locator.clear({ noWaitAfter: 1 } as never)).rejects.toThrow(
      "clear noWaitAfter must be a boolean"
    );
  });
});

describe("Locator highlights", () => {
  it("converts object styles and delegates them to the cached InjectedScript", async () => {
    document.body.innerHTML = '<div class="target"></div>';
    const page = createPage() as unknown as PageImpl;
    const injected = injectedFor(page);
    const addHighlight = vi.spyOn(injected, "addHighlight");

    await page.locator(".target").highlight({
      style: { backgroundColor: "red", zIndex: 3, "--accent": "blue" },
    });
    await page.locator(".target").highlight({ style: "outline: solid" });

    expect(addHighlight.mock.calls.map(([, style]) => style)).toEqual([
      "background-color: red; z-index: 3; --accent: blue",
      "outline: solid",
    ]);
  });

  it("allows no match, removes only one locator highlight, and clears all page highlights", async () => {
    document.body.innerHTML =
      '<div class="first"></div><div class="second"></div>';
    const page = createPage() as unknown as PageImpl;
    const injected = injectedFor(page);
    const removeHighlight = vi.spyOn(injected, "removeHighlight");
    const hideHighlight = vi.spyOn(injected, "hideHighlight");

    await expect(page.locator(".missing").highlight()).resolves.toBeDefined();
    await page.locator(".first").hideHighlight();
    await page.hideHighlight();

    expect(removeHighlight).toHaveBeenCalledTimes(1);
    expect(hideHighlight).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid selectors and disposes a highlight once", async () => {
    document.body.innerHTML = '<div class="target"></div>';
    const page = createPage() as unknown as PageImpl;
    const injected = injectedFor(page);
    const removeHighlight = vi.spyOn(injected, "removeHighlight");

    await expect(page.locator("[").highlight()).rejects.toThrow();
    const disposable = await page.locator(".target").highlight();
    await disposable.dispose();
    await disposable[Symbol.asyncDispose]();

    expect(removeHighlight).toHaveBeenCalledTimes(1);
  });
});

describe("Page web storage", () => {
  it("exposes independent native local and session storage wrappers", async () => {
    const page = createPage();

    expect(await page.localStorage.getItem("missing")).toBeNull();
    await page.localStorage.setItem("first", "one");
    await page.localStorage.setItem("second", "two");
    await page.localStorage.setItem("first", "updated");
    await page.sessionStorage.setItem("first", "session");

    expect(await page.localStorage.items()).toEqual([
      { name: "first", value: "updated" },
      { name: "second", value: "two" },
    ]);
    expect(await page.sessionStorage.items()).toEqual([
      { name: "first", value: "session" },
    ]);
    await page.localStorage.removeItem("first");
    await page.localStorage.clear();
    expect(await page.localStorage.items()).toEqual([]);
    expect(await page.sessionStorage.getItem("first")).toBe("session");
  });
});

describe("AdapterElementHandle state", () => {
  it("reports handle state and returns itself from asElement", async () => {
    document.body.innerHTML = `
      <button id="enabled">Enabled</button>
      <button id="disabled" disabled>Disabled</button>
      <div id="hidden" hidden></div>
    `;
    const page = createPage();
    const enabled = (await page.$("#enabled"))!;
    const disabled = (await page.$("#disabled"))!;
    const hidden = (await page.$("#hidden"))!;

    expect(enabled.asElement()).toBe(enabled);
    await expect(enabled.isEnabled()).resolves.toBe(true);
    await expect(disabled.isDisabled()).resolves.toBe(true);
    await expect(hidden.isVisible()).resolves.toBe(false);
    await expect(hidden.isHidden()).resolves.toBe(true);
  });

  it("uses Playwright detached semantics while preserving disposed-handle errors", async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const page = createPage();
    const handle = (await page.$("#target"))!;
    document.querySelector("#target")!.remove();

    await expect(handle.isVisible()).resolves.toBe(false);
    await expect(handle.isHidden()).resolves.toBe(true);
    await expect(handle.isEnabled()).rejects.toThrow(
      "Element is not attached to the DOM"
    );
    await expect(handle.isDisabled()).rejects.toThrow(
      "Element is not attached to the DOM"
    );
    await handle.dispose();
    await expect(handle.isVisible()).rejects.toThrow(
      "ElementHandle has been disposed"
    );
  });
});

function injectedFor(page: PageImpl) {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(page),
    "injected"
  )?.get;
  if (!getter) throw new Error("PageImpl injected getter is unavailable");
  return getter.call(page);
}
