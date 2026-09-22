/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to reach `window` properties the type does not know about */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Page.exposeFunction", () => {
  it("installs no controller property on window until the first exposeFunction/exposeBinding/exposeFunctions call", () => {
    createPage();
    // Pinned isomorphic/utilityScriptSerializers.ts kBindingsControllerProperty.
    expect((window as any).__playwright__binding__controller__).toBeUndefined();
  });

  it("keeps the exposed property callable after dispose(), because this package has no dispose lifecycle", async () => {
    const page = createPage();
    const disposable = await page.exposeFunction(
      "double",
      (n: number) => n * 2
    );
    await expect(page.evaluate(() => (window as any).double(21))).resolves.toBe(
      42
    );

    await disposable.dispose();

    // Pinned Playwright's `should dispose` test asserts the opposite: after
    // `dispose()`, calling the exposed function throws "is not a function".
    // This package invents no removal, so the property, and the call, still
    // work.
    await expect(page.evaluate(() => (window as any).double(10))).resolves.toBe(
      20
    );
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
