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
});
