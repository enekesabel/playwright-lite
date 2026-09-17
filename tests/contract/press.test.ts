/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.press", () => {
  it("press accepts the delay option", async () => {
    document.body.innerHTML = '<input type="text" />';
    const page = createPage();
    await page.locator("input").press("a", { delay: 1 });
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("a");
  });

  it("releases pressed keys when an abort interrupts the press delay", async () => {
    document.body.innerHTML = '<input type="text" />';
    const page = createPage();
    const input = document.querySelector("input") as HTMLInputElement;
    const keydowns: {
      key: string;
      repeat: boolean;
      shiftKey: boolean;
    }[] = [];
    input.addEventListener("keydown", (event) =>
      keydowns.push({
        key: event.key,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      })
    );
    const reason = new Error("stop");
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(reason), 50);

    const started = Date.now();
    const error = await page
      .locator("input")
      .press("Shift+a", {
        delay: 500,
        signal: controller.signal,
        timeout: 0,
      } as any)
      .then(
        () => undefined,
        (error) => error
      );
    const elapsed = Date.now() - started;

    expect(error?.name).toBe("AbortError");
    expect(error.message).toMatch(/^locator\.press: stop\nCall log:/);
    expect(error.cause).toBe(reason);
    expect(elapsed).toBeLessThan(300);

    expect(keydowns).toEqual([
      { key: "Shift", repeat: false, shiftKey: true },
      { key: "a", repeat: false, shiftKey: true },
    ]);

    const typed = input.value;
    await page.locator("input").press("a");
    expect(keydowns.at(-1)).toEqual({
      key: "a",
      repeat: false,
      shiftKey: false,
    });
    expect(input.value).toBe(`${typed}a`);

    await expect(
      page.locator("input").press("Shift+a", { delay: 500, timeout: 50 } as any)
    ).rejects.toThrow("Timeout 50ms exceeded");
    await page.locator("input").press("a");
    expect(keydowns.at(-1)).toEqual({
      key: "a",
      repeat: false,
      shiftKey: false,
    });
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
    expect((document.querySelector("#radio") as HTMLInputElement).checked).toBe(
      false
    );
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
});

describe("Page.press", () => {
  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();

    await page.press("#input", "b");

    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "b"
    );
  });
});
