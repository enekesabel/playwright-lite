import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "./index";

afterEach(async () => {
  await createPage().hideHighlight();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("noWaitAfter", () => {
  it("accepts booleans and boxed booleans for click and press", async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const page = createPage();
    const target = document.querySelector<HTMLButtonElement>("#target")!;
    const events: string[] = [];
    target.addEventListener("click", () => events.push("click"));
    target.addEventListener("keydown", () => events.push("keydown"));

    await page.click("#target", { noWaitAfter: true });
    await page.locator("#target").press("a", { noWaitAfter: false });
    await page.locator("#target").click({ noWaitAfter: Object(false) });
    await page.press("#target", "a", { noWaitAfter: Object(true) });

    expect(events).toEqual(["click", "keydown", "click", "keydown"]);
  });

  it("validates click and press before dispatch", async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const page = createPage();
    const dispatched = vi.fn();
    const target = document.querySelector("button")!;
    target.addEventListener("click", dispatched);
    target.addEventListener("keydown", dispatched);
    const invalid = { noWaitAfter: "yes" } as never;

    for (const operation of [
      () => page.click("#target", invalid),
      () => page.locator("#target").click(invalid),
      () => page.press("#target", "a", invalid),
      () => page.locator("#target").press("a", invalid),
    ])
      await expect(operation()).rejects.toThrow(
        "noWaitAfter: expected boolean, got string"
      );
    expect(dispatched).not.toHaveBeenCalled();
    await expect(
      page.locator("#target").click({ unexpected: true } as never)
    ).rejects.toThrow("unsupported Playwright option(s): unexpected");
  });

  it("drops deprecated no-op values on every supported action path", async () => {
    document.body.innerHTML = `
      <input id="text"><input id="check" type="checkbox">
      <select><option value="one">One</option></select>
      <input id="file" type="file"><button>Target</button>
    `;
    const page = createPage();
    const options = { noWaitAfter: "ignored" } as never;
    await page.fill("#text", "page", options);
    await page.locator("#text").fill("locator", options);
    await page.locator("#text").clear(options);
    await page.type("#text", "a", options);
    await page.locator("#text").type("b", options);
    await page.locator("#text").pressSequentially("c", options);
    expect(await page.inputValue("#text")).toBe("abc");
    await page.hover("button", options);
    await page.locator("button").hover(options);
    await page.dblclick("button", options);
    await page.locator("button").dblclick(options);
    await page.check("#check", options);
    await page.locator("#check").uncheck(options);
    await page.locator("#check").check(options);
    await page.uncheck("#check", options);
    await page.setChecked("#check", true, options);
    await page.locator("#check").setChecked(false, options);
    expect(await page.isChecked("#check")).toBe(false);
    const selected = await page.selectOption("select", "one", options);
    expect(selected).toEqual(["one"]);
    const locatorSelected = await page
      .locator("select")
      .selectOption("one", options);
    expect(locatorSelected).toEqual(["one"]);
    await page.setInputFiles("#file", [], options);
    await page.locator("#file").setInputFiles([], options);
    const input = document.querySelector<HTMLInputElement>("#file")!;
    expect(input.files!.length).toBe(0);
  });
});

it("renders styled highlights and removes only the requested overlay", async () => {
  // Observe the real closed shadow root without changing its mode or the
  // production InjectedScript. These are DOM assertions, not delegate spies.
  const roots: ShadowRoot[] = [];
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    options: ShadowRootInit
  ) {
    const root = attachShadow.call(this, options);
    if (this.localName === "x-pw-glass") roots.push(root);
    return root;
  });
  const highlights = () =>
    roots.flatMap((root) =>
      Array.from(root.querySelectorAll<HTMLElement>("x-pw-highlight")).filter(
        (element) => element.isConnected
      )
    );
  document.body.innerHTML =
    '<button id="first">One</button><button id="second">Two</button>';
  const page = createPage();
  const first = page.locator("#first");
  const second = page.locator("#second");
  const disposable = await first.highlight({ style: "background-color: red" });
  await second.highlight({
    style: { backgroundColor: "lime", zIndex: 3, "--accent": "blue" },
  });
  await expect.poll(() => highlights().length).toBe(2);
  for (const root of roots) expect(root.mode).toBe("closed");
  for (const element of highlights())
    expect(element.getBoundingClientRect().width).toBeGreaterThan(0);
  const colors = highlights().map(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(colors).toEqual(["rgb(255, 0, 0)", "rgb(0, 255, 0)"]);
  expect(highlights()[1].style.zIndex).toBe("3");
  expect(highlights()[1].style.getPropertyValue("--accent").trim()).toBe(
    "blue"
  );

  await disposable.dispose();
  await disposable[Symbol.asyncDispose]();
  await expect.poll(() => highlights().length).toBe(1);
  const remainingColor = getComputedStyle(highlights()[0]).backgroundColor;
  expect(remainingColor).toBe("rgb(0, 255, 0)");
  await second.hideHighlight();
  await expect.poll(() => highlights().length).toBe(0);

  await first.highlight();
  await second.highlight();
  await page.locator(".missing").highlight();
  await expect.poll(() => highlights().length).toBe(2);
  await page.hideHighlight();
  await expect.poll(() => highlights().length).toBe(0);
  await expect(page.locator("[").highlight()).rejects.toThrow();
});

describe("Page web storage", () => {
  it("keeps storage independent without imposing key order", async () => {
    const page = createPage();
    expect(await page.localStorage.getItem("missing")).toBeNull();
    await page.localStorage.setItem("first", "one");
    await page.localStorage.setItem("second", "two");
    await page.localStorage.setItem("first", "updated");
    await page.sessionStorage.setItem("first", "session");
    expect(new Set(await page.localStorage.items())).toEqual(
      new Set([
        { name: "first", value: "updated" },
        { name: "second", value: "two" },
      ])
    );
    await page.localStorage.removeItem("first");
    expect(await page.localStorage.items()).toEqual([
      { name: "second", value: "two" },
    ]);
    await page.localStorage.clear();
    expect(await page.localStorage.items()).toEqual([]);
    expect(await page.sessionStorage.getItem("first")).toBe("session");
  });

  for (const kind of ["localStorage", "sessionStorage"] as const) {
    it(`${kind} validates strings before touching native storage`, async () => {
      const storage = createPage()[kind];
      await storage.setItem("key", "original");
      for (const value of [undefined, null, 123, true, {}, []]) {
        for (const operation of [
          () => storage.getItem(value as never),
          () => storage.removeItem(value as never),
          () => storage.setItem(value as never, "value"),
          () => storage.setItem("key", value as never),
        ])
          await expect(operation()).rejects.toThrow("expected string");
      }
      expect(await storage.items()).toEqual([
        { name: "key", value: "original" },
      ]);
      await storage.setItem(Object("boxed"), Object("accepted"));
      expect(await storage.getItem(Object("boxed"))).toBe("accepted");
      await storage.removeItem(Object("boxed"));
      expect(await storage.getItem("boxed")).toBeNull();
    });
  }
});

describe("AdapterElementHandle state", () => {
  it("reports state and returns itself from asElement", async () => {
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

  it("preserves detached and disposed handle behavior", async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const handle = (await createPage().$("#target"))!;
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
