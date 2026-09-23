/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to reach `window` properties the type does not know about */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.exposeFunction", () => {
  it("installs no controller property on window until the first exposeFunction/exposeBinding/exposeFunctions call", () => {
    createPage();
    // Pinned isomorphic/utilityScriptSerializers.ts kBindingsControllerProperty.
    expect((window as any).__playwright__binding__controller__).toBeUndefined();
  });

  it("removes the property on dispose() and frees the name for a new registration", async () => {
    const page = createPage();
    const first = await page.exposeFunction("double", (n: number) => n * 2);

    await first.dispose();

    expect("double" in window).toBe(false);
    const second = await page.exposeFunction("double", (n: number) => n * 3);
    await expect(page.evaluate(() => (window as any).double(7))).resolves.toBe(
      21
    );
    // Disposing an already removed registration leaves the new one alone.
    await first.dispose();
    await expect(page.evaluate(() => (window as any).double(7))).resolves.toBe(
      21
    );

    await second[Symbol.asyncDispose]();

    expect("double" in window).toBe(false);
  });

  it("leaves the property in place on dispose() when the Site has replaced it", async () => {
    const page = createPage();
    const disposable = await page.exposeFunction(
      "triple",
      (n: number) => n * 3
    );
    const siteFunction = (n: number) => n + 1;
    (window as any).triple = siteFunction;

    await disposable.dispose();

    expect((window as any).triple).toBe(siteFunction);
    delete (window as any).triple;
  });

  it("delivers a thrown Error to the Site as a fresh Error carrying the same name, message and stack", async () => {
    const page = createPage();
    await page.exposeFunction("woof", () => {
      throw new TypeError("WOOF WOOF");
    });
    const { message, name, isTypeErrorInstance } = await page.evaluate(
      async () => {
        try {
          await (window as any).woof();
          throw new Error("did not throw");
        } catch (error) {
          return {
            message: (error as Error).message,
            name: (error as Error).name,
            isTypeErrorInstance: error instanceof TypeError,
          };
        }
      }
    );
    expect({ message, name, isTypeErrorInstance }).toEqual({
      message: "WOOF WOOF",
      name: "TypeError",
      // Reconstructed via the by-value serializer (pinned serializeError /
      // parseError), so it is a plain `Error` in this document with `name`
      // set to "TypeError", not the exact `TypeError` instance the callback
      // threw.
      isTypeErrorInstance: false,
    });
  });
});
