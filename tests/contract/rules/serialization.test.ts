import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("serialization", () => {
  it("serializes DOM returns for every supported target evaluation entry point", async () => {
    document.body.innerHTML =
      '<section id="root"><button>Go</button></section>';
    const page = createPage();
    const root = await page.$("#root");
    if (!root) throw new Error("Missing test root");
    const single: [string, () => Promise<unknown>][] = [
      ["page.evaluate", () => page.evaluate(() => document.body)],
      ["page.$eval", () => page.$eval("button", (element) => element)],
      [
        "locator.evaluate",
        () => page.locator("button").evaluate((element) => element),
      ],
      ["elementHandle.evaluate", () => root.evaluate((element) => element)],
      ["elementHandle.$eval", () => root.$eval("button", (element) => element)],
    ];
    for (const [apiName, evaluate] of single)
      await expect(evaluate(), apiName).resolves.toBe("ref: <Node>");
    const many: [string, () => Promise<unknown>][] = [
      ["page.$$eval", () => page.$$eval("button", (elements) => elements)],
      [
        "locator.evaluateAll",
        () => page.locator("button").evaluateAll((elements) => elements),
      ],
      [
        "elementHandle.$$eval",
        () => root.$$eval("button", (elements) => elements),
      ],
    ];
    for (const [apiName, evaluate] of many)
      await expect(evaluate(), apiName).resolves.toEqual(["ref: <Node>"]);
    await expect(page.evaluate(() => [window, document])).resolves.toEqual([
      "ref: <Window>",
      "ref: <Document>",
    ]);
    await root.dispose();
  });

  it("evaluate's exposeFunctions option turns nested functions into callable bindings", async () => {
    document.body.innerHTML = "<button>Go</button>";
    const page = createPage();
    const button = await page.$("button");
    if (!button) throw new Error("Missing button");
    const double = (n: number) => n * 2;
    type Double = (n: number) => number;
    const cases: [string, () => Promise<unknown>][] = [
      [
        "page.evaluate",
        () =>
          page.evaluate((fn: Double) => fn(21), double, {
            exposeFunctions: true,
          }),
      ],
      [
        "locator.evaluate",
        () =>
          page
            .locator("button")
            .evaluate((_el, fn: Double) => fn(21), double, {
              exposeFunctions: true,
            }),
      ],
      [
        "elementHandle.evaluate",
        () =>
          button.evaluate((_el, fn: Double) => fn(21), double, {
            exposeFunctions: true,
          }),
      ],
    ];
    for (const [apiName, evaluate] of cases)
      await expect(evaluate(), apiName).resolves.toBe(42);

    // page.evaluateHandle keeps the argument's functions live for later calls
    // against the returned handle.
    const handle = await page.evaluateHandle(
      (fn: Double) => ({ call: (n: number) => fn(n) }),
      double,
      { exposeFunctions: true }
    );
    await expect(
      handle.evaluate((value: { call: (n: number) => number }) =>
        value.call(10)
      )
    ).resolves.toBe(20);

    // A function argument still rejects when the option is left off.
    await expect(
      page.evaluate((fn: Double) => fn(1), double)
    ).rejects.toThrow("Attempting to serialize unexpected value");
    await button.dispose();
  });
});
