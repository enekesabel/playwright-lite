import { beforeEach, describe, expect, it } from "vitest";
import { createPage } from "./index";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("pointer action compatibility", () => {
  it.each(["check", "uncheck", "setChecked"] as const)(
    "reports the invoked checked method: %s",
    async (method) => {
      document.body.innerHTML = "<button>go</button>";
      const page = createPage();
      const locator = page.locator("button");
      const handle = (await page.$("button"))!;
      const calls = [
        [
          "page",
          () =>
            method === "setChecked"
              ? page.setChecked("button", true)
              : page[method]("button"),
        ],
        [
          "locator",
          () =>
            method === "setChecked"
              ? locator.setChecked(true)
              : locator[method](),
        ],
        [
          "elementHandle",
          () =>
            method === "setChecked"
              ? handle.setChecked(true)
              : handle[method](),
        ],
      ] as const;
      for (const [kind, call] of calls) {
        const error = await call().then(
          () => null,
          (error: Error) => error
        );
        expect(error).toBeInstanceOf(Error);
        expect(error!.message.startsWith(`${kind}.${method}:`)).toBe(true);
        expect(error!.message).toContain("Not a checkbox");
      }
      document.body.innerHTML = `<input type="checkbox" disabled ${method === "uncheck" ? "checked" : ""}>`;
      const target = page.locator("input");
      const pending =
        method === "setChecked"
          ? target.setChecked(true, { timeout: 50 })
          : target[method]({ timeout: 50 });
      const error = await pending.then(
        () => null,
        (error: Error) => error
      );
      expect(error).toBeInstanceOf(Error);
      expect(error!.message.startsWith(`locator.${method}:`)).toBe(true);
      expect(error!.message).toContain("Timeout 50ms exceeded");
    }
  );

  it("dispatches dblclick only for the primary button", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    const events: number[] = [];
    const button = document.querySelector("button")!;
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("dblclick", (event) => events.push(event.button));
    await page.dblclick("button", { button: "right" });
    await page.locator("button").dblclick({ button: "middle" });
    await (await page.$("button"))!.dblclick();
    expect(events).toEqual([0]);
  });

  it("normalizes boxed pointer options and rejects fractional click counts", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    const options = Object.freeze({
      clickCount: Object(2),
      delay: Object(0),
      force: Object(false),
      trial: Object(false),
    });
    await page.click("button", options);
    expect(clicks).toBe(2);
    await expect(page.click("button", { clickCount: 1.5 })).rejects.toThrow(
      "clickCount: expected integer"
    );
    expect(clicks).toBe(2);
  });

  it("resolves Page selectors non-strictly but keeps Locators strict", async () => {
    document.body.innerHTML = "<button>A</button><button>B</button>";
    const buttons = [...document.querySelectorAll("button")];
    const clicks: string[] = [];
    buttons.forEach((button) =>
      button.addEventListener("click", () => clicks.push(button.textContent!))
    );
    const page = createPage();
    await page.click("button");
    await expect(page.locator("button").click()).rejects.toThrow(
      "strict mode violation"
    );
    await expect(page.click("button", { strict: true })).rejects.toThrow(
      "strict mode violation"
    );
    expect(clicks).toEqual(["A"]);
  });

  it("keeps ElementHandles fixed while Locators retry replacement nodes", async () => {
    document.body.innerHTML = "<button disabled>old</button>";
    const page = createPage();
    const handle = (await page.$("button"))!;
    const old = document.querySelector("button")!;
    let clicks = 0;
    const fixed = handle.click({ timeout: 500 }).catch((error: Error) => error);
    const resolved = page.locator("button").click({ timeout: 1000 });
    setTimeout(() => {
      const fresh = document.createElement("button");
      fresh.textContent = "new";
      fresh.addEventListener("click", () => clicks++);
      old.replaceWith(fresh);
    }, 30);
    expect(((await fixed) as Error).message).toContain(
      "Element is not attached to the DOM"
    );
    await resolved;
    expect(clicks).toBe(1);
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

  it("honors scroll:none for clicks and hover with positions and modifiers", async () => {
    document.body.innerHTML =
      '<div style="height:120px;overflow:auto"><button style="margin-top:3000px">go</button></div>';
    const page = createPage();
    const container = document.querySelector("div")!;
    await expect(
      page.locator("button").click({ scroll: "none", force: true })
    ).rejects.toThrow("outside of the viewport");
    expect(container.scrollTop).toBe(0);
    await page
      .locator("button")
      .hover({ modifiers: ["Shift"], position: { x: 4, y: 4 } });
    expect(container.scrollTop).toBeGreaterThan(0);
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
});
