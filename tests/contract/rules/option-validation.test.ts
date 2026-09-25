/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../../src/index";
import { report, swallowWindowErrors } from "../pageEvents";

swallowWindowErrors();

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
      /^check signal must be an AbortSignal/,
    ],
    [
      "waitForFunction",
      (page, options) =>
        page.waitForFunction(() => true, undefined, options as any),
      /waitForFunction signal must be an AbortSignal/,
    ],
    [
      "waitForLoadState",
      (page, options) => page.waitForLoadState("load", options as any),
      /waitForLoadState signal must be an AbortSignal/,
    ],
    [
      "waitForURL",
      (page, options) => page.waitForURL(location.href, options as any),
      /waitForURL signal must be an AbortSignal/,
    ],
    [
      "waitForEvent",
      (page, options) => page.waitForEvent("load", options as any),
      /waitForEvent signal must be an AbortSignal/,
    ],
    [
      "goBack",
      (page, options) => page.goBack(options as any),
      /goBack signal must be an AbortSignal/,
    ],
    [
      "goForward",
      (page, options) => page.goForward(options as any),
      /goForward signal must be an AbortSignal/,
    ],
    // Validation precedes navigation, so this never reloads the test document.
    [
      "reload",
      (page, options) => page.reload(options as any),
      /reload signal must be an AbortSignal/,
    ],
    [
      "elementHandle.waitForElementState",
      async (page, options) =>
        (await page.$("#input"))!.waitForElementState(
          "visible",
          options as any
        ),
      /waitForElementState signal must be an AbortSignal/,
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

  const exposeFunctionsActions: [
    string,
    (page: Page, options: unknown) => Promise<unknown>,
  ][] = [
    [
      "evaluate",
      (page, options) => page.evaluate(() => 1, undefined, options as any),
    ],
    [
      "evaluateHandle",
      (page, options) =>
        page.evaluateHandle(() => 1, undefined, options as any),
    ],
  ];

  it.each(exposeFunctionsActions)(
    "%s rejects a non-boolean exposeFunctions option",
    async (apiName, run) => {
      const page = createPage();
      await expect(
        run(page, { exposeFunctions: "yes" }),
        apiName
      ).rejects.toThrow("exposeFunctions must be a boolean");
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
    [
      "waitForLoadState",
      (page) => page.waitForLoadState("load", { unexpected: true } as any),
      /waitForLoadState\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "waitForURL",
      (page) => page.waitForURL(location.href, { unexpected: true } as any),
      /waitForURL\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "waitForEvent",
      (page) => page.waitForEvent("load", { unexpected: true } as any),
      /waitForEvent\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "goBack",
      (page) => page.goBack({ unexpected: true } as any),
      /goBack\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "goForward",
      (page) => page.goForward({ unexpected: true } as any),
      /goForward\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "reload",
      (page) => page.reload({ unexpected: true } as any),
      /reload\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "pageErrors",
      (page) => page.pageErrors({ unexpected: true } as any),
      /pageErrors\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "consoleMessages",
      (page) => page.consoleMessages({ unexpected: true } as any),
      /consoleMessages\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "removeAllListeners",
      (page) => page.removeAllListeners("load", { unexpected: true } as any),
      /removeAllListeners\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "waitForRequest",
      (page) => page.waitForRequest("**/*", { predicate: () => true } as any),
      /waitForRequest\(\): unsupported Playwright option\(s\): predicate/,
    ],
    [
      "waitForResponse",
      (page) => page.waitForResponse("**/*", { predicate: () => true } as any),
      /waitForResponse\(\): unsupported Playwright option\(s\): predicate/,
    ],
    [
      "elementHandle.selectText",
      async (page) =>
        (await page.$("#input"))!.selectText({ unexpected: true } as any),
      /selectText\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    // The checked actions share one implementation; each still reports the
    // member the consumer called.
    [
      "elementHandle.check",
      async (page) =>
        (await page.$("#input"))!.check({ unexpected: true } as any),
      /^check\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "elementHandle.uncheck",
      async (page) =>
        (await page.$("#input"))!.uncheck({ unexpected: true } as any),
      /^uncheck\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "page.check",
      (page) => page.check("#input", { unexpected: true } as any),
      /^check\(\): unsupported Playwright option\(s\): unexpected/,
    ],
    [
      "locator.uncheck",
      (page) => page.locator("#input").uncheck({ unexpected: true } as any),
      /^uncheck\(\): unsupported Playwright option\(s\): unexpected/,
    ],
  ];

  it.each(unsupportedActions)(
    "%s rejects options it does not support",
    async (_apiName, run, message) => {
      document.body.innerHTML = targets;
      await expect(run(createPage())).rejects.toThrow(message);
    }
  );

  // pageErrors and consoleMessages share the same `filter` rule: an
  // unsupported value is rejected, and "all" and the default
  // "since-navigation" return the same entries, since this single-document
  // adapter never crosses documents within one page's lifetime.
  const historyFilterCases: [
    string,
    (page: Page) => Promise<void>,
    (page: Page, filter?: "all" | "since-navigation") => Promise<string[]>,
  ][] = [
    [
      "pageErrors",
      async () => {
        report(new Error("one"));
        report(new Error("two"));
      },
      async (page, filter) =>
        (await page.pageErrors(filter ? { filter } : undefined)).map(
          (e) => e.message
        ),
    ],
    [
      "consoleMessages",
      async (page) => {
        await page.consoleMessages();
        console.log("one");
        console.log("two");
      },
      async (page, filter) =>
        (await page.consoleMessages(filter ? { filter } : undefined)).map((m) =>
          m.text()
        ),
    ],
  ];

  it.each(historyFilterCases)(
    "%s rejects an unsupported filter value",
    async (_apiName, seed, read) => {
      const page = createPage();
      await seed(page);
      await expect(read(page, "unknown" as "all")).rejects.toThrow(
        "filter: expected one of (all|since-navigation)"
      );
    }
  );

  it.each(historyFilterCases)(
    '%s: filter "all" and the default "since-navigation" return the same entries',
    async (_apiName, seed, read) => {
      const page = createPage();
      await seed(page);

      const [all, sinceNavigation, defaulted] = await Promise.all([
        read(page, "all"),
        read(page, "since-navigation"),
        read(page),
      ]);
      expect(all).toEqual(["one", "two"]);
      expect(sinceNavigation).toEqual(all);
      expect(defaulted).toEqual(all);
    }
  );

  // The visibility reads are one-shot: the pinned API declares no `signal`,
  // ignores `timeout`, and (on Page) validates a boolean `strict`.
  const visibilityReads: [
    string,
    (page: Page, options: unknown) => Promise<boolean>,
    boolean,
  ][] = [
    ["page.isVisible", (page, o) => page.isVisible("#button", o as any), true],
    ["page.isHidden", (page, o) => page.isHidden("#button", o as any), false],
    [
      "locator.isVisible",
      (page, o) => page.locator("#button").isVisible(o as any),
      true,
    ],
    [
      "locator.isHidden",
      (page, o) => page.locator("#button").isHidden(o as any),
      false,
    ],
  ];

  it.each(visibilityReads)(
    "%s rejects a defined signal as unsupported",
    async (apiName, run) => {
      document.body.innerHTML = targets;
      const page = createPage();
      const aborted = new AbortController();
      aborted.abort(new Error("stop"));
      for (const signal of [aborted.signal, new AbortController().signal]) {
        const error = await run(page, { signal }).then(
          () => undefined,
          (error) => error
        );
        const context = `${apiName} aborted=${signal.aborted}`;
        expect(error?.name, context).not.toBe("AbortError");
        expect(error?.message, context).toBe(
          "Unsupported query option: signal"
        );
      }
    }
  );

  it.each(visibilityReads)(
    "%s treats an undefined signal as absent",
    async (_apiName, run, visible) => {
      document.body.innerHTML = targets;
      await expect(run(createPage(), { signal: undefined })).resolves.toBe(
        visible
      );
    }
  );

  it.each(visibilityReads)(
    "%s accepts and ignores any timeout",
    async (apiName, run, visible) => {
      document.body.innerHTML = targets;
      const page = createPage();
      for (const timeout of [-1, NaN, "soon", 1e12])
        await expect(
          run(page, { timeout }),
          `${apiName} ${timeout}`
        ).resolves.toBe(visible);
    }
  );

  it.each(visibilityReads.filter(([apiName]) => apiName.startsWith("page.")))(
    "%s rejects a non-boolean strict",
    async (apiName, run, visible) => {
      document.body.innerHTML = targets;
      const page = createPage();
      const member = apiName.slice("page.".length);
      for (const strict of ["yes", 1, null]) {
        const error = await run(page, { strict }).then(
          () => undefined,
          (error) => error
        );
        expect(error, `${apiName} ${strict}`).toBeInstanceOf(TypeError);
        expect(error.message, `${apiName} ${strict}`).toBe(
          `${member} strict must be a boolean`
        );
      }
      await expect(run(page, { strict: true })).resolves.toBe(visible);
    }
  );

  it.each(
    visibilityReads.filter(([apiName]) => apiName.startsWith("locator."))
  )("%s rejects strict", async (_apiName, run) => {
    document.body.innerHTML = targets;
    await expect(run(createPage(), { strict: true })).rejects.toThrow(
      "Unsupported query option: strict"
    );
  });

  // Contract coverage: no upstream spec passes a non-boolean `strict` to
  // waitForSelector. Pinned protocol validation rejects one on both forms.
  const waitForSelectorForms: [
    string,
    (page: Page, options: unknown) => Promise<unknown>,
  ][] = [
    [
      "page.waitForSelector",
      (page, o) => page.waitForSelector("#button", o as any),
    ],
    [
      "elementHandle.waitForSelector",
      async (page, o) =>
        (await page.$("body"))!.waitForSelector("#button", o as any),
    ],
  ];

  it.each(waitForSelectorForms)(
    "%s rejects a non-boolean strict",
    async (apiName, run) => {
      document.body.innerHTML = targets;
      const page = createPage();
      for (const strict of ["yes", 1, null]) {
        const error = await run(page, { strict }).then(
          () => undefined,
          (error) => error
        );
        expect(error, `${apiName} ${strict}`).toBeInstanceOf(TypeError);
        expect(error.message, `${apiName} ${strict}`).toBe(
          "waitForSelector strict must be a boolean"
        );
      }
      await expect(run(page, { strict: true })).resolves.toBeTruthy();
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

  // `force` is `boolean?` in the pinned protocol for every action that takes
  // it, so a boxed `Boolean` unwraps and anything else is rejected.
  it("rejects a non-boolean force and unwraps a boxed one", async () => {
    document.body.innerHTML =
      '<input id="input" type="date" />' +
      '<select id="select"><option value="one">One</option></select>';
    const page = createPage();
    const input = page.locator("#input");
    const select = page.locator("#select");
    const actions: [string, (options: unknown) => Promise<unknown>][] = [
      ["fill", (o) => page.fill("#input", "2020-01-01", o as any)],
      ["fill", (o) => input.fill("2020-01-01", o as any)],
      ["clear", (o) => input.clear(o as any)],
      ["selectOption", (o) => page.selectOption("#select", "one", o as any)],
      ["selectOption", (o) => select.selectOption("one", o as any)],
      ["selectText", (o) => input.selectText(o as any)],
      [
        "fill",
        async (o) => (await page.$("#input"))!.fill("2020-01-01", o as any),
      ],
      [
        "selectOption",
        async (o) => (await page.$("#select"))!.selectOption("one", o as any),
      ],
      [
        "selectText",
        async (o) => (await page.$("#input"))!.selectText(o as any),
      ],
    ];

    for (const [apiName, run] of actions) {
      const error = await run({ force: "yes" }).then(
        () => undefined,
        (error) => error
      );
      expect(error, apiName).toBeInstanceOf(TypeError);
      expect(error.message, apiName).toBe(`${apiName} force must be a boolean`);
      await run({ force: Object(true) });
    }
  });

  // `steps` is `int?` in the pinned protocol for click and dblclick.
  it("rejects a non-integer click or dblclick steps", async () => {
    document.body.innerHTML = '<button id="button">ok</button>';
    const page = createPage();
    const button = page.locator("#button");
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    const actions: [string, (options: unknown) => Promise<unknown>][] = [
      ["click", (o) => button.click(o as any)],
      ["dblclick", (o) => button.dblclick(o as any)],
    ];

    for (const [apiName, run] of actions) {
      await expect(run({ steps: "5" }), apiName).rejects.toThrow(
        "steps: expected number"
      );
      await expect(run({ steps: 1.5 }), apiName).rejects.toThrow(
        "steps: expected integer, got float 1.5"
      );
    }
    // Invalid input must fail before dispatching any event.
    expect(clicks).toBe(0);

    for (const [, run] of actions) await run({ steps: Object(2) });
    expect(clicks).toBeGreaterThan(0);
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
