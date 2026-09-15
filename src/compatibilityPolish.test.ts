import type { Locator, Page } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { createPage } from "./index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.waitFor attachment states", () => {
  it("waits for insertion and removal with the existing strict polling loop", async () => {
    const page = createPage();
    const locator = page.locator("#target");
    const attached = locator.waitFor({ state: "attached", timeout: 1000 });
    document.body.innerHTML = '<div id="target" hidden></div>';
    await attached;

    let completed = false;
    const detached = locator
      .waitFor({ state: "detached", timeout: 1000 })
      .then(() => {
        completed = true;
      });
    await page.waitForTimeout(75);
    expect(completed).toBe(false);
    document.querySelector("#target")!.remove();
    await detached;
    expect(completed).toBe(true);
  });

  it.each(["attached", "detached"] as const)(
    "keeps %s waits strict",
    async (state) => {
      document.body.innerHTML =
        '<div class="target"></div><div class="target"></div>';
      await expect(
        createPage().locator(".target").waitFor({ state, timeout: 100 })
      ).rejects.toThrow("strict mode violation");
    }
  );

  it.each(["attached", "detached"] as const)(
    "honors the default timeout for %s",
    async (state) => {
      document.body.innerHTML =
        state === "detached" ? '<div id="target"></div>' : "";
      const page = createPage();
      page.setDefaultTimeout(30);
      await expect(page.locator("#target").waitFor({ state })).rejects.toThrow(
        "Timeout 30ms exceeded"
      );
    }
  );
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

  it("validates new options and ignores undefined unsupported options", async () => {
    document.body.innerHTML = '<button id="target">Click</button>';
    const page = createPage();
    const locator = page.locator("#target");
    const click =
      owner === "Page"
        ? page.click.bind(page, "#target")
        : locator.click.bind(locator);
    // Invalid input must fail before dispatching any event.
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    await expect(
      click({ trial: "yes" } as unknown as Parameters<typeof click>[0])
    ).rejects.toThrow("trial must be a boolean");
    await expect(click({ position: { x: NaN, y: 0 } })).rejects.toThrow(
      "finite x and y"
    );
    expect(clicks).toBe(0);
    await click({ force: undefined, trial: true });
    expect(clicks).toBe(0);
  });
});

it("Locator.all captures the length, not the resolved elements", async () => {
  document.body.innerHTML = "<ul><li>old</li></ul>";
  const locators = await createPage().locator("li").all();
  document.querySelector("ul")!.innerHTML = "<li>new</li><li>extra</li>";
  expect(locators).toHaveLength(1);
  expect(await locators[0]!.textContent()).toBe("new");
});

type StrictOptions = { strict?: boolean; timeout?: number };
type SelectorActionCase = {
  name: string;
  html: string;
  pageAction: (page: Page, options?: StrictOptions) => Promise<unknown>;
  locatorAction: (locator: Locator) => Promise<unknown>;
  values: () => unknown[];
  changed: unknown[];
  unchanged: unknown[];
};

const selectorActions: SelectorActionCase[] = [
  {
    name: "fill",
    html: '<input class="target"><input class="target">',
    pageAction: (page, options) => page.fill(".target", "value", options),
    locatorAction: (locator) => locator.fill("value"),
    values: () =>
      [...document.querySelectorAll<HTMLInputElement>(".target")].map(
        (element) => element.value
      ),
    changed: ["value", ""],
    unchanged: ["", ""],
  },
  {
    name: "focus",
    html: '<input class="target"><input class="target">',
    pageAction: (page, options) => page.focus(".target", options),
    locatorAction: (locator) => locator.focus(),
    values: () =>
      [...document.querySelectorAll<HTMLInputElement>(".target")].map(
        (element) => document.activeElement === element
      ),
    changed: [true, false],
    unchanged: [false, false],
  },
  {
    name: "press",
    html: '<input class="target"><input class="target">',
    pageAction: (page, options) => page.press(".target", "a", options),
    locatorAction: (locator) => locator.press("a"),
    values: () =>
      [...document.querySelectorAll<HTMLInputElement>(".target")].map(
        (element) => element.value
      ),
    changed: ["a", ""],
    unchanged: ["", ""],
  },
  {
    name: "type",
    html: '<input class="target"><input class="target">',
    pageAction: (page, options) => page.type(".target", "a", options),
    locatorAction: (locator) => locator.type("a"),
    values: () =>
      [...document.querySelectorAll<HTMLInputElement>(".target")].map(
        (element) => element.value
      ),
    changed: ["a", ""],
    unchanged: ["", ""],
  },
  {
    name: "selectOption",
    html:
      '<select class="target"><option value="a">A</option><option value="b">B</option></select>' +
      '<select class="target"><option value="a">A</option><option value="b">B</option></select>',
    pageAction: (page, options) => page.selectOption(".target", "b", options),
    locatorAction: (locator) => locator.selectOption("b"),
    values: () =>
      [...document.querySelectorAll<HTMLSelectElement>(".target")].map(
        (element) => element.value
      ),
    changed: ["b", "a"],
    unchanged: ["a", "a"],
  },
];

describe.each(selectorActions)("Page.$name selector matching", (action) => {
  it.each([undefined, { strict: false }] as const)(
    "uses the first match with options %j",
    async (options) => {
      document.body.innerHTML = action.html;
      await action.pageAction(createPage(), options);
      expect(action.values()).toEqual(action.changed);
    }
  );

  it("supports strict opt-in without side effects", async () => {
    document.body.innerHTML = action.html;
    await expect(
      action.pageAction(createPage(), { strict: true })
    ).rejects.toThrow("strict mode violation");
    expect(action.values()).toEqual(action.unchanged);
  });

  it("keeps the Locator form strict", async () => {
    document.body.innerHTML = action.html;
    const page = createPage();
    await expect(action.locatorAction(page.locator(".target"))).rejects.toThrow(
      "strict mode violation"
    );
    expect(action.values()).toEqual(action.unchanged);
  });
});

it("Page.fill waits on the first match instead of choosing a later actionable match", async () => {
  document.body.innerHTML =
    '<input class="target" disabled><input class="target">';
  const values = () =>
    [...document.querySelectorAll<HTMLInputElement>(".target")].map(
      (element) => element.value
    );

  await expect(
    createPage().fill(".target", "value", { timeout: 50 })
  ).rejects.toThrow("Timeout 50ms exceeded");
  expect(values()).toEqual(["", ""]);
});

it("Page.selectOption waits on the first match instead of choosing a later actionable match", async () => {
  document.body.innerHTML =
    '<select class="target" disabled><option value="a">A</option><option value="b">B</option></select>' +
    '<select class="target"><option value="a">A</option><option value="b">B</option></select>';
  const selects = [...document.querySelectorAll<HTMLSelectElement>(".target")];
  const events: string[] = [];
  for (const select of selects)
    for (const name of ["input", "change"])
      select.addEventListener(name, () => events.push(name));

  await expect(
    createPage().selectOption(".target", "b", { timeout: 50 })
  ).rejects.toThrow("Timeout 50ms exceeded");
  expect(selects.map((select) => select.value)).toEqual(["a", "a"]);
  expect(events).toEqual([]);
});

describe.each(["Page", "Locator"] as const)("%s.type empty text", (owner) => {
  const type = (
    page: Page,
    text: string,
    options?: StrictOptions
  ): Promise<void> =>
    owner === "Page"
      ? page.type(".target", text, options)
      : page.locator(".target").type(text);

  it("enforces strictness before focus or input", async () => {
    document.body.innerHTML =
      '<input class="target" value="first"><input class="target" value="second">';
    const inputs = [...document.querySelectorAll<HTMLInputElement>(".target")];
    const events: string[] = [];
    for (const input of inputs)
      for (const name of ["focus", "keydown", "input"])
        input.addEventListener(name, () => events.push(name));

    await expect(
      type(createPage(), "", owner === "Page" ? { strict: true } : undefined)
    ).rejects.toThrow("strict mode violation");
    expect(document.activeElement).toBe(document.body);
    expect(inputs.map((input) => input.value)).toEqual(["first", "second"]);
    expect(events).toEqual([]);
  });

  it("resolves and focuses once before typing", async () => {
    document.body.innerHTML = '<input class="target"><input id="other">';
    const target = document.querySelector<HTMLInputElement>(".target")!;
    const other = document.querySelector<HTMLInputElement>("#other")!;
    target.addEventListener("input", () => other.focus(), { once: true });

    await type(createPage(), "ab");
    expect(target.value).toBe("a");
    expect(other.value).toBe("b");
    expect(document.activeElement).toBe(other);
  });

  it("does not retarget a replacement after typing starts", async () => {
    document.body.innerHTML = '<input class="target">';
    const target = document.querySelector<HTMLInputElement>(".target")!;
    let replacement: HTMLInputElement | undefined;
    target.addEventListener(
      "input",
      () => {
        target.remove();
        replacement = document.createElement("input");
        replacement.className = "target";
        document.body.append(replacement);
      },
      { once: true }
    );

    await type(createPage(), "ab");
    expect(target.value).toBe("a");
    expect(replacement?.value).toBe("");
  });
});

it("Page.type empty text focuses the first match without keyboard input", async () => {
  document.body.innerHTML =
    '<input class="target" value="first"><input class="target" value="second">';
  const inputs = [...document.querySelectorAll<HTMLInputElement>(".target")];
  const events: string[] = [];
  for (const input of inputs)
    for (const name of ["keydown", "input"])
      input.addEventListener(name, () => events.push(name));

  await createPage().type(".target", "");
  expect(document.activeElement).toBe(inputs[0]);
  expect(inputs.map((input) => input.value)).toEqual(["first", "second"]);
  expect(events).toEqual([]);
});

it("Page.type empty text waits for a matching selector", async () => {
  await expect(
    createPage().type(".target", "", { timeout: 50 })
  ).rejects.toThrow("Timeout 50ms exceeded");
});
