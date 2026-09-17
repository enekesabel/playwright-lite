/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Markup that every option-validation target below resolves against. */
const targets =
  '<button id="button">ok</button>' +
  '<div id="focusable" tabindex="0">d</div>' +
  '<input id="input" type="text" />';

describe("option-validation", () => {
  // `check` reports through the shared setChecked path, so it carries its own
  // expected prefix.
  const signalActions: [
    string,
    (page: Page, options: unknown) => Promise<unknown>,
    RegExp,
  ][] = [
    [
      "click",
      (page, options) => page.locator("#button").click(options as any),
      /click signal must be an AbortSignal/,
    ],
    [
      "focus",
      (page, options) => page.locator("#focusable").focus(options as any),
      /focus signal must be an AbortSignal/,
    ],
    [
      "blur",
      (page, options) => page.locator("#focusable").blur(options as any),
      /blur signal must be an AbortSignal/,
    ],
    [
      "check",
      (page, options) => page.locator("#input").check(options as any),
      /signal must be an AbortSignal/,
    ],
  ];

  it.each(signalActions)(
    "%s validates the signal option",
    async (apiName, run, message) => {
      document.body.innerHTML = targets;
      const page = createPage();
      for (const signal of [true, false, null]) {
        await expect(
          run(page, { signal }),
          `${apiName} ${signal}`
        ).rejects.toThrow(message);
      }
    }
  );

  const unsupportedActions: [
    string,
    (page: Page) => Promise<unknown>,
    RegExp,
  ][] = [
    [
      "focus",
      (page) => page.locator("#focusable").focus({ force: true } as any),
      /focus\(\): unsupported Playwright option\(s\): force/,
    ],
    [
      "blur",
      (page) => page.locator("#focusable").blur({ force: true } as any),
      /blur\(\): unsupported Playwright option\(s\): force/,
    ],
    [
      "fill",
      (page) => page.locator("#input").fill("x", { force: true } as any),
      /unsupported Playwright option.*force/,
    ],
    [
      "pressSequentially",
      (page) =>
        page
          .locator("#input")
          .pressSequentially("a", { delay: 1, force: true } as any),
      /unsupported Playwright option/,
    ],
    [
      "click",
      (page) => page.locator("#button").click({ unexpected: true } as any),
      /unsupported Playwright option\(s\): unexpected/,
    ],
  ];

  it.each(unsupportedActions)(
    "%s rejects options it does not support",
    async (_apiName, run, message) => {
      document.body.innerHTML = targets;
      await expect(run(createPage())).rejects.toThrow(message);
    }
  );

  it("ignores unsupported options whose values are undefined", async () => {
    document.body.innerHTML = "<button>ok</button>";
    const page = createPage();
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => {
      clicks++;
    });

    await page.locator("button").click({ signal: undefined } as any);
    expect(clicks).toBe(1);
  });

  it("rejects a non-numeric press or type delay", async () => {
    document.body.innerHTML = '<input id="input" type="text" />';
    const page = createPage();
    const locator = page.locator("#input");
    const actions: [string, () => Promise<unknown>][] = [
      ["page.press", () => page.press("#input", "a", { delay: "x" } as any)],
      ["page.type", () => page.type("#input", "a", { delay: "x" } as any)],
      ["locator.press", () => locator.press("a", { delay: "x" } as any)],
      ["locator.type", () => locator.type("a", { delay: "x" } as any)],
      [
        "locator.pressSequentially",
        () => locator.pressSequentially("a", { delay: "x" } as any),
      ],
    ];

    for (const [apiName, run] of actions) {
      const error = await run().then(
        () => undefined,
        (error) => error
      );
      expect(error, apiName).toBeInstanceOf(TypeError);
      expect(error.message, apiName).toBe("delay: expected number");
    }
    expect(document.querySelector<HTMLInputElement>("#input")!.value).toBe("");
  });

  describe.each(["Page", "Locator"] as const)("%s.click options", (owner) => {
    const clickOf = (page: Page) => {
      const locator = page.locator("#target");
      return owner === "Page"
        ? page.click.bind(page, "#target")
        : locator.click.bind(locator);
    };

    it("validates new options and ignores undefined unsupported options", async () => {
      document.body.innerHTML = '<button id="target">Click</button>';
      const page = createPage();
      const click = clickOf(page);
      // Invalid input must fail before dispatching any event.
      let clicks = 0;
      document
        .querySelector("button")!
        .addEventListener("click", () => clicks++);
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
});
