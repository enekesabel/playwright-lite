import type { Locator, Page } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

type StrictOptions = { strict?: boolean; timeout?: number };

type StrictnessCase = {
  apiName: string;
  html: string;
  /** Attaches observers to the freshly written markup and returns a reader. */
  observe: () => () => unknown[];
  pageAction: (page: Page, options?: StrictOptions) => Promise<unknown>;
  locatorAction: (locator: Locator) => Promise<unknown>;
  changed: unknown[];
  unchanged: unknown[];
};

const inputs = '<input class="target"><input class="target">';
const selects =
  '<select class="target"><option value="a">A</option><option value="b">B</option></select>' +
  '<select class="target"><option value="a">A</option><option value="b">B</option></select>';

const targets = <T extends Element>(): T[] => [
  ...document.querySelectorAll<T>(".target"),
];

const inputValues = () => () =>
  targets<HTMLInputElement>().map((element) => element.value);

const selectValues = () => () =>
  targets<HTMLSelectElement>().map((element) => element.value);

const selectorActions: StrictnessCase[] = [
  {
    apiName: "fill",
    html: inputs,
    observe: inputValues,
    pageAction: (page, options) => page.fill(".target", "value", options),
    locatorAction: (locator) => locator.fill("value"),
    changed: ["value", ""],
    unchanged: ["", ""],
  },
  {
    apiName: "focus",
    html: inputs,
    observe: () => () =>
      targets<HTMLInputElement>().map(
        (element) => document.activeElement === element
      ),
    pageAction: (page, options) => page.focus(".target", options),
    locatorAction: (locator) => locator.focus(),
    changed: [true, false],
    unchanged: [false, false],
  },
  {
    apiName: "press",
    html: inputs,
    observe: inputValues,
    pageAction: (page, options) => page.press(".target", "a", options),
    locatorAction: (locator) => locator.press("a"),
    changed: ["a", ""],
    unchanged: ["", ""],
  },
  {
    apiName: "type",
    html: inputs,
    observe: inputValues,
    pageAction: (page, options) => page.type(".target", "a", options),
    locatorAction: (locator) => locator.type("a"),
    changed: ["a", ""],
    unchanged: ["", ""],
  },
  {
    apiName: "selectOption",
    html: selects,
    observe: selectValues,
    pageAction: (page, options) => page.selectOption(".target", "b", options),
    locatorAction: (locator) => locator.selectOption("b"),
    changed: ["b", "a"],
    unchanged: ["a", "a"],
  },
  {
    apiName: "click",
    html: '<button class="target">A</button><button class="target">B</button>',
    observe: () => {
      const clicks: string[] = [];
      for (const button of targets<HTMLButtonElement>())
        button.addEventListener("click", () =>
          clicks.push(button.textContent!)
        );
      return () => clicks;
    },
    pageAction: (page, options) => page.click(".target", options),
    locatorAction: (locator) => locator.click(),
    changed: ["A"],
    unchanged: [],
  },
];

describe("strictness", () => {
  describe.each(selectorActions)("$apiName", (action) => {
    it.each([undefined, { strict: false }] as const)(
      "uses the first match with Page options %j",
      async (options) => {
        document.body.innerHTML = action.html;
        const observed = action.observe();
        await action.pageAction(createPage(), options);
        expect(observed()).toEqual(action.changed);
      }
    );

    it("supports strict opt-in without side effects", async () => {
      document.body.innerHTML = action.html;
      const observed = action.observe();
      await expect(
        action.pageAction(createPage(), { strict: true })
      ).rejects.toThrow("strict mode violation");
      expect(observed()).toEqual(action.unchanged);
    });

    it("keeps the Locator form strict", async () => {
      document.body.innerHTML = action.html;
      const observed = action.observe();
      const page = createPage();
      await expect(
        action.locatorAction(page.locator(".target"))
      ).rejects.toThrow("strict mode violation");
      expect(observed()).toEqual(action.unchanged);
    });
  });

  const firstMatchWaits: {
    apiName: string;
    html: string;
    run: (page: Page) => Promise<unknown>;
    values: () => unknown[];
    unchanged: unknown[];
  }[] = [
    {
      apiName: "fill",
      html: '<input class="target" disabled><input class="target">',
      run: (page) => page.fill(".target", "value", { timeout: 50 }),
      values: () => targets<HTMLInputElement>().map((element) => element.value),
      unchanged: ["", ""],
    },
    {
      apiName: "selectOption",
      html:
        '<select class="target" disabled><option value="a">A</option><option value="b">B</option></select>' +
        '<select class="target"><option value="a">A</option><option value="b">B</option></select>',
      run: (page) => page.selectOption(".target", "b", { timeout: 50 }),
      values: () =>
        targets<HTMLSelectElement>().map((element) => element.value),
      unchanged: ["a", "a"],
    },
  ];

  it.each(firstMatchWaits)(
    "Page.$apiName waits on the first match instead of choosing a later actionable match",
    async ({ html, run, values, unchanged }) => {
      document.body.innerHTML = html;
      const events: string[] = [];
      for (const element of targets())
        for (const name of ["input", "change"])
          element.addEventListener(name, () => events.push(name));

      await expect(run(createPage())).rejects.toThrow("Timeout 50ms exceeded");
      expect(values()).toEqual(unchanged);
      expect(events).toEqual([]);
    }
  );
});
