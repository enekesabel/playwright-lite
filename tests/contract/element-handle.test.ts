import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import { PageImpl } from "../../src/page";

describe("ElementHandle", () => {
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

    await expect(root.evaluate((element) => element.textContent)).resolves.toBe(
      "before"
    );
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

  it("reports its own waitForSelector timeout", async () => {
    document.body.innerHTML = '<section id="root"></section>';
    const page = createPage();
    const root = (await page.$("#root"))!;

    await expect(
      root.waitForSelector("#missing", { timeout: 25 })
    ).rejects.toThrow("elementHandle.waitForSelector: Timeout 25ms exceeded.");
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

  it("stays fixed while Locators retry replacement nodes", async () => {
    document.body.innerHTML = "<button disabled>old</button>";
    const page = createPage();
    const handle = (await page.$("button"))!;
    const old = document.querySelector("button")!;
    const fixed = handle.click({ timeout: 500 }).catch((error: Error) => error);
    setTimeout(() => {
      const fresh = document.createElement("button");
      fresh.textContent = "new";
      old.replaceWith(fresh);
    }, 30);
    expect(((await fixed) as Error).message).toContain(
      "Element is not attached to the DOM"
    );
    await handle.dispose();
    await expect(handle.click()).rejects.toThrow(/disposed/);
  });

  it("supports every handle pointer method and preserves checked idempotence", async () => {
    document.body.innerHTML = '<button>go</button><input type="checkbox">';
    const page = createPage();
    const button = (await page.$("button"))!;
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    await button.hover();
    await button.click();
    await button.dblclick();
    expect(clicks).toBe(3);
    const checkbox = (await page.$("input"))!;
    let changes = 0;
    document
      .querySelector("input")!
      .addEventListener("change", () => changes++);
    await checkbox.check();
    await checkbox.check();
    await checkbox.uncheck();
    await checkbox.setChecked(true);
    expect(await checkbox.isChecked()).toBe(true);
    expect(changes).toBe(3);
  });

  it("presses a key into the fixed element", async () => {
    document.body.innerHTML = '<input value="hello"><input value="other">';
    const page = createPage();
    const handle = (await page.$("input"))!;

    await handle.press("w");

    expect(document.querySelectorAll("input")[0].value).toBe("whello");
    expect(document.querySelectorAll("input")[1].value).toBe("other");
  });

  it("selects the text of the fixed element", async () => {
    document.body.innerHTML = '<input value="hello">';
    const page = createPage();
    const handle = (await page.$("input"))!;

    await handle.selectText();

    const input = document.querySelector("input")!;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it("fills the fixed element", async () => {
    document.body.innerHTML = '<input value="one"><input value="two">';
    const page = createPage();
    const handle = (await page.$("input"))!;

    await handle.fill("filled");

    expect(document.querySelectorAll("input")[0].value).toBe("filled");
    expect(document.querySelectorAll("input")[1].value).toBe("two");
  });

  // Pinned dom.ts runs `checkElementStates` only when `force` is unset, for the
  // handle form exactly as for the selector forms. The date input keeps the
  // assertion on InjectedScript's direct set-value path, which completes
  // without any keyboard input of its own.
  it("fills, selects and selects text on a hidden fixed element with force", async () => {
    document.body.innerHTML =
      '<input id=date type=date style="display:none">' +
      '<input id=text value=hello style="display:none">' +
      '<select id=select style="display:none"><option value=one>One</option></select>';
    const page = createPage();
    const date = (await page.$("#date"))!;
    const text = (await page.$("#text"))!;
    const select = (await page.$("#select"))!;

    await expect(date.fill("2020-01-01", { timeout: 20 })).rejects.toThrow(
      /Timeout 20ms exceeded/
    );
    await expect(select.selectOption("one", { timeout: 20 })).rejects.toThrow(
      /Timeout 20ms exceeded/
    );
    await expect(text.selectText({ timeout: 20 })).rejects.toThrow(
      /Timeout 20ms exceeded/
    );

    await date.fill("2020-01-01", { force: true });
    await expect(select.selectOption("one", { force: true })).resolves.toEqual([
      "one",
    ]);
    await text.selectText({ force: true });

    expect(document.querySelector<HTMLInputElement>("#date")!.value).toBe(
      "2020-01-01"
    );
    expect(document.querySelector<HTMLSelectElement>("#select")!.value).toBe(
      "one"
    );
    const input = document.querySelector<HTMLInputElement>("#text")!;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it("reports a fill rejection through the handle member", async () => {
    document.body.innerHTML = "<select><option>one</option></select>";
    const page = createPage();
    const handle = (await page.$("select"))!;

    const error = await handle.fill("x").then(
      () => null,
      (error: Error) => error
    );

    expect(error!.message).toBe(
      "elementHandle.fill: Error: Element is not an <input>, <textarea> or [contenteditable] element\n" +
        "Call log:\n  - attempting fill action\n" +
        "    - waiting for element to be visible, enabled and editable"
    );
  });

  // Pinned dom.ts logs the state wait only when the action is not forced.
  it("omits the state wait from a forced fill call log", async () => {
    document.body.innerHTML = "<select><option>one</option></select>";
    const page = createPage();
    const handle = (await page.$("select"))!;

    const error = await handle.fill("x", { force: true }).then(
      () => null,
      (error: Error) => error
    );

    expect(error!.message).toBe(
      "elementHandle.fill: Error: Element is not an <input>, <textarea> or [contenteditable] element\n" +
        "Call log:\n  - attempting fill action"
    );
  });

  it("focuses the fixed element", async () => {
    document.body.innerHTML = '<input id="one"><input id="two">';
    const page = createPage();
    const handle = (await page.$("input"))!;

    await handle.focus();

    expect(document.activeElement!.id).toBe("one");
  });

  it("types into the fixed element", async () => {
    document.body.innerHTML = '<input value="hello"><input value="other">';
    const page = createPage();
    const handle = (await page.$("input"))!;

    await handle.type("world");

    expect(document.querySelectorAll("input")[0].value).toBe("worldhello");
    expect(document.querySelectorAll("input")[1].value).toBe("other");
  });

  it("selects an option on the fixed element", async () => {
    document.body.innerHTML =
      "<select><option>one</option><option>two</option></select>" +
      "<select><option>three</option></select>";
    const page = createPage();
    const handle = (await page.$("select"))!;

    await expect(handle.selectOption("two")).resolves.toEqual(["two"]);

    expect(document.querySelectorAll("select")[0].value).toBe("two");
  });

  it("sets input files on the fixed element", async () => {
    document.body.innerHTML = '<input type="file"><input type="file">';
    const page = createPage();
    const handle = (await page.$("input"))!;

    await handle.setInputFiles({
      name: "upload.txt",
      mimeType: "text/plain",
      buffer: new TextEncoder().encode("contents") as Buffer,
    });

    const inputs = document.querySelectorAll<HTMLInputElement>("input");
    expect(Array.from(inputs[0].files!, (file) => file.name)).toEqual([
      "upload.txt",
    ]);
    expect(inputs[1].files!.length).toBe(0);
  });

  it("dispatches an event on the fixed element", async () => {
    document.body.innerHTML = "<button>go</button><button>other</button>";
    const page = createPage();
    const handle = (await page.$("button"))!;
    const clicked: string[] = [];
    for (const button of document.querySelectorAll("button"))
      button.addEventListener("click", () => clicked.push(button.textContent!));

    await handle.dispatchEvent("click");

    expect(clicked).toEqual(["go"]);
  });

  it("keeps action members bound to a detached or disposed handle", async () => {
    document.body.innerHTML = '<input value="one">';
    const page = createPage();
    const handle = (await page.$("input"))!;
    document.querySelector("input")!.remove();

    await expect(handle.focus()).rejects.toThrow(
      "Element is not attached to the DOM"
    );
    await expect(handle.type("x")).rejects.toThrow(
      "Element is not attached to the DOM"
    );
    await expect(handle.dispatchEvent("click")).rejects.toThrow(
      "Element is not attached to the DOM"
    );
    await handle.dispose();
    await expect(handle.fill("x")).rejects.toThrow(/disposed/);
  });

  it.each(["check", "uncheck", "setChecked"] as const)(
    "reports the invoked checked method: %s",
    async (method) => {
      document.body.innerHTML = "<button>go</button>";
      const page = createPage();
      const handle = (await page.$("button"))!;
      const error = await (
        method === "setChecked" ? handle.setChecked(true) : handle[method]()
      ).then(
        () => null,
        (error: Error) => error
      );
      expect(error).toBeInstanceOf(Error);
      expect(error!.message.startsWith(`elementHandle.${method}:`)).toBe(true);
      expect(error!.message).toContain("Not a checkbox");
    }
  );
});
