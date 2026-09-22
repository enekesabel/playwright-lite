/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.evaluateHandle", () => {
  it("evaluates against the resolved element and keeps the result in the document", async () => {
    document.body.innerHTML = '<ul id="list"><li>One</li><li>Two</li></ul>';
    const page = createPage();

    const handle = await page.locator("#list").evaluateHandle(
      (element, suffix: string) => ({
        node: element.lastElementChild,
        text: element.firstElementChild!.textContent + suffix,
      }),
      "!"
    );

    await expect(
      handle.getProperty("text").then((h) => h.jsonValue())
    ).resolves.toBe("One!");
    const node = await handle.getProperty("node");
    expect(node.asElement()).toBe(node);
    await expect((node as any).textContent()).resolves.toBe("Two");
  });

  it("waits for a strict Locator.evaluateHandle target and honors its options", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    window.setTimeout(
      () => (document.body.innerHTML = '<p id="ready">Ready</p>'),
      25
    );

    const handle = await page
      .locator("#ready")
      .evaluateHandle((element) => element.textContent, undefined, {
        timeout: 100,
      });
    await expect(handle.jsonValue()).resolves.toBe("Ready");

    document.body.innerHTML = "<p>First</p><p>Second</p>";
    await expect(
      page.locator("p").evaluateHandle((element) => element.textContent)
    ).rejects.toThrow(/strict mode violation/);

    const cancelled = new AbortController();
    window.setTimeout(() => cancelled.abort("cancel evaluateHandle"), 10);
    const inFlightError = await page
      .locator("#missing")
      .evaluateHandle((element) => element.textContent, undefined, {
        timeout: 100,
        signal: cancelled.signal,
      } as any)
      .then(
        () => undefined,
        (error: Error) => error
      );
    expect(inFlightError?.name).toBe("AbortError");
    expect(inFlightError?.message).toBe(
      "locator.evaluateHandle: cancel evaluateHandle\nCall log:\n  - operation was aborted: cancel evaluateHandle"
    );
  });
});

describe("Page.evaluateHandle", () => {
  it("settles a returned promise before handing back the handle", async () => {
    const page = createPage();

    const handle = await page.evaluateHandle(() => Promise.resolve({ a: 1 }));

    await expect(handle.jsonValue()).resolves.toEqual({ a: 1 });
    expect(handle.toString()).toBe("Object");
  });

  it("rejects the evaluation argument forms Playwright rejects", async () => {
    const page = createPage();

    await expect(
      (page as any).evaluateHandle((one: number) => one, 1, {}, 2)
    ).rejects.toThrow(/Too many arguments/);
    await expect(
      (page as any).evaluateHandle(() => 1, undefined, [])
    ).rejects.toThrow(/Too many arguments/);
    await expect(
      (page as any).evaluateHandle(() => 1, undefined, {
        exposeFunctions: "yes",
      })
    ).rejects.toThrow("exposeFunctions must be a boolean");
  });
});
