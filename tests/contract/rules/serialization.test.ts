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
});
