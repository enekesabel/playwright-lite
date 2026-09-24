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
          page.locator("button").evaluate((_el, fn: Double) => fn(21), double, {
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
    await button.dispose();
  });

  it("infers an empty or omitted file payload MIME type from the name for every file-accepting member", async () => {
    // Contract coverage: no pinned upstream spec sends an empty or omitted
    // mimeType. Pinned server/fileUploadUtils.ts falls back to
    // mime.getType(name), then application/octet-stream.
    document.body.innerHTML =
      '<input id="file" type="file" multiple><div id="zone" style="width: 100px; height: 100px;"></div>';
    const input = document.querySelector<HTMLInputElement>("#file")!;
    let dropped: File[] = [];
    const zone = document.querySelector("#zone")!;
    zone.addEventListener("dragover", (event) => event.preventDefault());
    zone.addEventListener("drop", (event) => {
      dropped = Array.from((event as DragEvent).dataTransfer!.files);
    });
    const page = createPage();
    const handle = (await page.$("#file"))!;
    const bytes = new TextEncoder().encode("x") as Buffer;
    // The public type requires mimeType; Playwright's protocol accepts it
    // omitted and infers it the same way as an empty string.
    const files = [
      { name: "notes.TXT", mimeType: "", buffer: bytes },
      { name: "photo.png", buffer: bytes } as unknown as {
        name: string;
        mimeType: string;
        buffer: Buffer;
      },
      { name: "data.unknown-extension", mimeType: "", buffer: bytes },
      { name: "explicit.png", mimeType: "text/plain", buffer: bytes },
    ];
    const expected = [
      "text/plain",
      "image/png",
      "application/octet-stream",
      "text/plain",
    ];
    const members: [string, () => Promise<File[]>][] = [
      [
        "page.setInputFiles",
        async () => {
          await page.setInputFiles("#file", files);
          return Array.from(input.files!);
        },
      ],
      [
        "locator.setInputFiles",
        async () => {
          await page.locator("#file").setInputFiles(files);
          return Array.from(input.files!);
        },
      ],
      [
        "elementHandle.setInputFiles",
        async () => {
          await handle.setInputFiles(files);
          return Array.from(input.files!);
        },
      ],
      [
        "locator.drop",
        async () => {
          await page.locator("#zone").drop({ files });
          return dropped;
        },
      ],
    ];
    for (const [apiName, run] of members) {
      input.value = "";
      dropped = [];
      expect(
        (await run()).map((file) => file.type),
        apiName
      ).toEqual(expected);
    }
    await handle.dispose();
  });
});
