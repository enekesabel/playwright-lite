/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.click", () => {
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

  it("keeps the actionability timeout message when the deadline expires mid-action", async () => {
    document.body.innerHTML = "<button>ok</button>";
    const page = createPage();
    const button = document.querySelector("button") as HTMLButtonElement & {
      scrollIntoViewIfNeeded?: () => void;
    };
    // Burn the deadline between the preflight check and the actionability
    // wait that follows the scroll.
    const stall = () => {
      const end = Date.now() + 400;
      while (Date.now() < end);
    };
    button.scrollIntoViewIfNeeded = stall;
    button.scrollIntoView = stall;

    const error = await page
      .locator("button")
      .click({ timeout: 200 })
      .then(
        () => undefined,
        (error: Error) => error
      );

    expect(error?.message).not.toContain("action: Timeout");
    expect(error?.message).toMatch(/^locator\.click: Timeout 200ms exceeded\./);
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

  it("runs trial checks without dispatching clicks", async () => {
    document.body.innerHTML = `
      <button id=button style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px">go</button>
      <button id=disabled disabled style="position: fixed; left: 10px; top: 80px; width: 100px; height: 40px">no</button>
    `;
    const page = createPage();
    let clicks = 0;
    document
      .querySelector("#button")!
      .addEventListener("click", () => clicks++);

    await page.locator("#button").click({ trial: true });

    expect(clicks).toBe(0);
    await expect(
      page.locator("#disabled").click({ trial: true })
    ).rejects.toThrow(/not enabled/);
  });

  it("respects preventDefault on click and keeps native activation working", async () => {
    document.body.innerHTML = `
      <button id=button style="position: fixed; left: 10px; top: 20px; width: 100px; height: 40px">go</button>
      <input id=checkbox type=checkbox />
    `;
    const page = createPage();
    const button = document.querySelector("#button")!;
    const checkbox = document.querySelector("#checkbox") as HTMLInputElement;
    let activations = 0;
    let changes = 0;
    button.addEventListener("click", () => activations++);
    checkbox.addEventListener("change", () => changes++);

    checkbox.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await page.locator("#checkbox").click();
    expect(checkbox.checked).toBe(false);
    expect(changes).toBe(0);

    await page.locator("#button").click();
    expect(activations).toBe(1);
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

  it("click succeeds without options", async () => {
    document.body.innerHTML = "<button>ok</button>";
    const page = createPage();
    await page.locator("button").click();
  });

  it("dispatches right and middle buttons without a primary click", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const events: [string, number, number][] = [];
    const button = document.querySelector("button")!;
    for (const name of [
      "mousedown",
      "mouseup",
      "contextmenu",
      "click",
      "auxclick",
    ])
      button.addEventListener(name, (event) => {
        const mouse = event as MouseEvent;
        events.push([name, mouse.button, mouse.buttons]);
      });
    await page.click("button", { button: "right" });
    await page.locator("button").click({ button: "middle" });
    expect(events).toEqual([
      ["mousedown", 2, 2],
      ["contextmenu", 2, 2],
      ["mouseup", 2, 0],
      ["auxclick", 2, 0],
      ["mousedown", 1, 4],
      ["mouseup", 1, 0],
      ["auxclick", 1, 0],
    ]);
  });

  it("restores held modifiers after overrides and trial runs", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const modifiers: [boolean, boolean][] = [];
    const keyboardEvents: string[] = [];
    const button = document.querySelector("button")!;
    button.addEventListener("click", (event) =>
      modifiers.push([event.ctrlKey, event.shiftKey])
    );
    button.addEventListener("keydown", (event) =>
      keyboardEvents.push(event.key)
    );
    await page.keyboard.down("Control");
    await page.locator("button").click({ modifiers: ["Shift"] });
    await page.click("button");
    await page.locator("button").click({ modifiers: ["Alt"], trial: true });
    await page.click("button");
    await page.keyboard.up("Control");
    expect(modifiers).toEqual([
      [false, true],
      [true, false],
      [true, false],
    ]);
    expect(keyboardEvents).toContain("Alt");
  });

  it("preserves click counts, delay, pressure and microtask ordering", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const button = document.querySelector("button")!;
    const details: number[] = [];
    const pressures: number[] = [];
    const gaps: number[] = [];
    let downAt = 0;
    let microtaskRan = false;
    button.addEventListener("pointerdown", (event) =>
      pressures.push(event.pressure)
    );
    button.addEventListener("pointerup", (event) =>
      pressures.push(event.pressure)
    );
    button.addEventListener("mousedown", () => {
      downAt = performance.now();
      microtaskRan = false;
      queueMicrotask(() =>
        queueMicrotask(() => {
          microtaskRan = true;
        })
      );
    });
    button.addEventListener("mouseup", () => {
      gaps.push(performance.now() - downAt);
      expect(microtaskRan).toBe(true);
    });
    button.addEventListener("click", (event) => details.push(event.detail));
    await page.click("button", { clickCount: 3, delay: 25 });
    expect(details).toEqual([1, 2, 3]);
    expect(pressures).toEqual([0.5, 0, 0.5, 0, 0.5, 0]);
    expect(gaps).toHaveLength(3);
    expect(gaps.every((gap) => gap >= 25)).toBe(true);
  });

  it("force bypasses hit checks, not geometry or actual event targeting", async () => {
    document.body.innerHTML =
      '<button style="position:fixed;left:30px;top:30px;width:80px;height:40px">go</button><div id="cover" style="position:fixed;inset:0;z-index:10"></div>';
    const page = createPage();
    let buttonClicks = 0,
      coverClicks = 0;
    document
      .querySelector("button")!
      .addEventListener("click", () => buttonClicks++);
    document
      .querySelector("#cover")!
      .addEventListener("click", () => coverClicks++);
    await page.locator("button").click({ force: true });
    expect([buttonClicks, coverClicks]).toEqual([0, 1]);
    document.querySelector("button")!.style.display = "none";
    await expect(page.click("button", { force: true })).rejects.toThrow(
      "Element is not visible"
    );
    expect([buttonClicks, coverClicks]).toEqual([0, 1]);
  });

  it("honors scroll: none and rejects a target outside the viewport", async () => {
    document.body.innerHTML =
      '<div style="height:120px;overflow:auto"><button style="margin-top:3000px">go</button></div>';
    const page = createPage();
    const container = document.querySelector("div")!;
    await expect(
      page.locator("button").click({ scroll: "none", force: true })
    ).rejects.toThrow("outside of the viewport");
    expect(container.scrollTop).toBe(0);
  });

  it("does not dispatch delayed activation after timeout and restores modifiers", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const events: string[] = [];
    const button = document.querySelector("button")!;
    for (const name of ["mousedown", "mouseup", "click"])
      button.addEventListener(name, () => events.push(name));
    await expect(
      page.click("button", { delay: 500, timeout: 150, modifiers: ["Shift"] })
    ).rejects.toThrow("Timeout 150ms exceeded");
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(events).toEqual(["mousedown"]);
    let shifted = true;
    button.addEventListener("click", (event) => {
      shifted = event.shiftKey;
    });
    await page.click("button");
    expect(shifted).toBe(false);
  });

  it("intercepts layout changes caused by hover before activating", async () => {
    document.body.innerHTML =
      '<button style="position:fixed;left:30px;top:30px;width:80px;height:40px">go</button>';
    const page = createPage();
    let clicks = 0;
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => clicks++);
    button.addEventListener(
      "pointerover",
      () => {
        const cover = document.createElement("div");
        cover.id = "cover";
        cover.style.cssText = "position:fixed;inset:0;z-index:100";
        cover.addEventListener("click", () => clicks++);
        document.body.append(cover);
      },
      { once: true }
    );
    await expect(page.click("button", { timeout: 200 })).rejects.toThrow(
      "Timeout 200ms exceeded"
    );
    expect(clicks).toBe(0);
    document.querySelector("#cover")!.remove();
    await page.click("button");
    expect(clicks).toBe(1);
  });

  it("retries with the freshly resolved node when the old element is replaced", async () => {
    document.body.innerHTML = "<button disabled>old</button>";
    const page = createPage();
    const old = document.querySelector("button")!;
    let clicks = 0;
    const resolved = page.locator("button").click({ timeout: 1000 });
    setTimeout(() => {
      const fresh = document.createElement("button");
      fresh.textContent = "new";
      fresh.addEventListener("click", () => clicks++);
      old.replaceWith(fresh);
    }, 30);
    await resolved;
    expect(clicks).toBe(1);
  });

  it("retries hidden actions until the state becomes actionable", async () => {
    document.body.innerHTML = `
      <button id="button" style="display:none">go</button>
    `;
    const page = createPage();
    let clicked = false;
    document
      .querySelector("#button")!
      .addEventListener("click", () => (clicked = true));

    window.setTimeout(() => {
      document.querySelector("#button")!.removeAttribute("style");
    }, 25);

    await page.locator("#button").click();

    expect(clicked).toBe(true);
  });
});

describe("Page.click", () => {
  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<button id=button>Click</button>`;
    const page = createPage();
    const button = document.querySelector("#button")!;
    let clicks = 0;
    button.addEventListener("click", () => clicks++);

    await page.click("#button");

    expect(clicks).toBe(1);
  });
});

describe.each(["Page", "Locator"] as const)("%s.click options", (owner) => {
  it("checks trial actionability without dispatching input events", async () => {
    document.body.innerHTML = '<button id="target" disabled>Click</button>';
    const button = document.querySelector<HTMLButtonElement>("#target")!;
    const events: string[] = [];
    for (const name of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ])
      button.addEventListener(name, () => events.push(name));
    const page = createPage();
    const click =
      owner === "Page"
        ? page.click.bind(page, "#target")
        : page.locator("#target").click.bind(page.locator("#target"));
    await expect(click({ trial: true, timeout: 50 })).rejects.toThrow(
      "Timeout 50ms exceeded"
    );
    button.disabled = false;
    await click({ trial: true });
    expect(events).toEqual([]);
    await click();
    expect(events).toContain("click");
  });

  it("uses the requested padding-box position", async () => {
    document.body.innerHTML =
      '<button id="target" style="width:100px;height:60px;border:8px solid black">Click</button>';
    const button = document.querySelector<HTMLButtonElement>("#target")!;
    let point: { x: number; y: number } | undefined;
    button.addEventListener("click", (event) => {
      point = { x: event.clientX, y: event.clientY };
    });
    const page = createPage();
    const options = { position: { x: 20, y: 10 } };
    if (owner === "Page") await page.click("#target", options);
    else await page.locator("#target").click(options);
    const bounds = button.getBoundingClientRect();
    expect(point).toEqual({ x: bounds.x + 8 + 20, y: bounds.y + 8 + 10 });
  });

  it.each([false, true])(
    "scrolls an oversized target's requested point (nested: %s)",
    async (nested) => {
      document.body.innerHTML = `<div id="container" style="${nested ? "width:250px;height:200px;overflow:auto;" : ""}"><div id="target" style="margin-top:100px;width:${window.innerWidth * 3}px;height:${window.innerHeight * 3}px;border:8px solid black">Click</div></div>`;
      const button = document.querySelector<HTMLDivElement>("#target")!;
      const events: { x: number; y: number }[] = [];
      button.addEventListener("click", (event) =>
        events.push({ x: event.clientX, y: event.clientY })
      );
      const page = createPage();
      const click =
        owner === "Page"
          ? page.click.bind(page, "#target")
          : page.locator("#target").click.bind(page.locator("#target"));
      for (const position of [
        { x: 10, y: 10 },
        { x: window.innerWidth * 2, y: window.innerHeight * 2 },
      ]) {
        const before = events.length;
        await click({ position, trial: true, timeout: 1000 });
        expect(events).toHaveLength(before);
        await click({ position, timeout: 1000 });
        const bounds = button.getBoundingClientRect();
        expect(events.at(-1)).toEqual({
          x: bounds.x + 8 + position.x,
          y: bounds.y + 8 + position.y,
        });
        expect(events.at(-1)!.x).toBeGreaterThanOrEqual(0);
        expect(events.at(-1)!.x).toBeLessThan(window.innerWidth);
        expect(events.at(-1)!.y).toBeGreaterThanOrEqual(0);
        expect(events.at(-1)!.y).toBeLessThan(window.innerHeight);
      }
    }
  );
});
