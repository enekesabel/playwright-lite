import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Keyboard", () => {
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

  it("exposes stable page.keyboard state to the current focused element", async () => {
    document.body.innerHTML =
      "<input id=input /><textarea id=textarea></textarea>";
    const page = createPage();
    const keyboard = page.keyboard;
    const input = document.querySelector("#input") as HTMLInputElement;
    const textarea = document.querySelector("#textarea") as HTMLTextAreaElement;
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
        input.addEventListener(type, () => events.push(`${type}:${input.id}`));
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
    const textarea = document.querySelector("#textarea") as HTMLTextAreaElement;
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
});
