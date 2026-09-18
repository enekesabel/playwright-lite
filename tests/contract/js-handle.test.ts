/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("JSHandle", () => {
  it("handle.dispose() returns a Promise", async () => {
    const page = createPage();
    const handle = await (page as any).waitForFunction(() => 1);
    const result = handle.dispose();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it("invalidates primitive waitForFunction handles on disposal", async () => {
    const page = createPage();
    const handle = await page.waitForFunction(() => 1);
    await expect(handle.jsonValue()).resolves.toBe(1);
    await handle.dispose();
    await expect(handle.jsonValue()).rejects.toThrow(/disposed/i);
    await expect(page.evaluate((value) => value, { handle })).rejects.toThrow(
      /disposed/i
    );
    await expect(handle.dispose()).resolves.toBeUndefined();
  });

  it("disposes through the async disposal protocol and keeps its preview", async () => {
    const page = createPage();
    const handle = await page.evaluateHandle(() => ({ kept: true }));

    await handle[Symbol.asyncDispose]();

    expect(handle.toString()).toBe("Object");
    await expect(handle.jsonValue()).rejects.toThrow("JSHandle is disposed!");
  });

  it("refuses a handle created by another page", async () => {
    document.body.innerHTML = "<p>shared document</p>";
    const page = createPage();
    const other = createPage();
    const foreign = await other.evaluateHandle(() => 1);
    const foreignElement = await other.$("p");

    await expect(page.evaluate((value) => value, foreign)).rejects.toThrow(
      "JSHandles can be evaluated only in the context they were created!"
    );
    await expect(
      page.evaluate((value) => value, foreignElement)
    ).rejects.toThrow(
      "JSHandles can be evaluated only in the context they were created!"
    );
  });

  it("lists only the own enumerable data properties as handles", async () => {
    const page = createPage();
    const handle = await page.evaluateHandle(() => {
      const value = { own: 1 };
      Object.defineProperty(value, "hidden", { value: 2, enumerable: false });
      Object.defineProperty(value, "computed", {
        get: () => 3,
        enumerable: true,
      });
      Object.setPrototypeOf(value, { inherited: 4 });
      return value;
    });

    const properties = await handle.getProperties();

    expect([...properties.keys()]).toEqual(["own"]);
    await expect(properties.get("own")!.jsonValue()).resolves.toBe(1);
    // getProperty reads through the prototype chain and through accessors.
    await expect(
      (await handle.getProperty("inherited")).jsonValue()
    ).resolves.toBe(4);
    await expect(
      (await handle.getProperty("computed")).jsonValue()
    ).resolves.toBe(3);
  });
});
