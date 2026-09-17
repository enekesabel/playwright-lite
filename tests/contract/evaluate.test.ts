/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

afterEach(() => {
  delete (window as any).__evaluationCalls;
});

describe("Locator.evaluate", () => {
  it("runs Locator callbacks through the pinned evaluation boundary", async () => {
    document.body.innerHTML = "<li>One</li><li>Two</li>";
    const page = createPage();
    const items = page.locator("li");

    await expect(
      items
        .first()
        .evaluate(
          (element, suffix: string) => element.textContent + suffix,
          "!"
        )
    ).resolves.toBe("One!");
  });

  it("waits for a strict Locator.evaluate target and honors its options", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    window.setTimeout(
      () => (document.body.innerHTML = "<p id=ready>Ready</p>"),
      25
    );

    await expect(
      page
        .locator("#ready")
        .evaluate((element) => element.textContent, undefined, {
          timeout: 100,
        })
    ).resolves.toBe("Ready");

    document.body.innerHTML = "<p>First</p><p>Second</p>";
    await expect(
      page.locator("p").evaluate((element) => element.textContent)
    ).rejects.toThrow(/strict mode violation/);

    const cancelled = new AbortController();
    window.setTimeout(() => cancelled.abort("cancel evaluate"), 10);
    const inFlightError = await page
      .locator("#missing")
      .evaluate((element) => element.textContent, undefined, {
        timeout: 100,
        signal: cancelled.signal,
      })
      .then(
        () => undefined,
        (error: Error) => error
      );
    expect(inFlightError?.name).toBe("AbortError");
    expect(inFlightError?.message).toBe(
      "cancel evaluate\nCall log:\n  - operation was aborted: cancel evaluate"
    );
    expect(inFlightError?.cause).toBe("cancel evaluate");
  });

  it("unwraps nested handles while copying the containing argument", async () => {
    document.body.innerHTML = '<button id="target">Go</button>';
    const page = createPage();
    const handle = await page.$("button");
    if (!handle) throw new Error("Missing test handle");
    const original = { nested: { handles: [handle], value: 1 } };
    const result = await page.locator("button").evaluate((element, value) => {
      value.nested.value = 2;
      return {
        same: element === value.nested.handles[0],
        id: value.nested.handles[0].id,
      };
    }, original);
    expect(result).toEqual({ same: true, id: "target" });
    expect(original.nested.value).toBe(1);
    await handle.dispose();
    await expect(page.evaluate((value) => value, { handle })).rejects.toThrow(
      /disposed/i
    );
  });

  it("does not invoke callbacks again when their errors resemble selector failures", async () => {
    document.body.innerHTML = "<button>Go</button>";
    const page = createPage();
    await expect(
      page.locator("button").evaluate(
        () => {
          (window as any).__evaluationCalls =
            ((window as any).__evaluationCalls ?? 0) + 1;
          throw new Error("No elements found for locator callback");
        },
        undefined,
        { timeout: 50 }
      )
    ).rejects.toThrow("No elements found for locator callback");
    expect((window as any).__evaluationCalls).toBe(1);
  });
});

describe("Page.evaluate", () => {
  it("evaluates a function and returns its result", async () => {
    const page = createPage();
    const result = await page.evaluate(() => 1 + 2);
    expect(result).toBe(3);
  });

  it("passes arg to the function", async () => {
    const page = createPage();
    const result = await page.evaluate((n: number) => n * 3, 7);
    expect(result).toBe(21);
  });

  it("never retries after runtime exception", async () => {
    const page = createPage();
    await expect(page.evaluate("throw new Error('boom')")).rejects.toThrow(
      "boom"
    );
  });

  it("can read the DOM", async () => {
    document.body.innerHTML = "<div id='target'>hi</div>";
    const page = createPage();
    const text = await page.evaluate(
      () => document.getElementById("target")?.textContent
    );
    expect(text).toBe("hi");
  });

  it("can mutate the DOM", async () => {
    document.body.innerHTML = "<div id='mut'>before</div>";
    const page = createPage();
    await page.evaluate(() => {
      document.getElementById("mut")!.textContent = "after";
    });
    const el = document.getElementById("mut");
    expect(el?.textContent).toBe("after");
  });

  it("copies evaluation arguments and results like Playwright", async () => {
    const original = { nested: { value: 1 } };
    const result = await createPage().evaluate((argument) => {
      argument.nested.value = 2;
      return argument;
    }, original);
    expect(original).toEqual({ nested: { value: 1 } });
    expect(result).toEqual({ nested: { value: 2 } });
    expect(result).not.toBe(original);
    expect(result.nested).not.toBe(original.nested);
  });

  it("does not transport lexical closures", async () => {
    const onlyInCaller = 42;
    expect(onlyInCaller).toBe(42);
    await expect(createPage().evaluate(() => onlyInCaller)).rejects.toThrow(
      "onlyInCaller"
    );
  });

  it("preserves graph structure without sharing caller objects", async () => {
    const shared = { value: 3 };
    const original: any = { first: shared, second: shared };
    original.self = original;
    const result = await createPage().evaluate((value) => value, original);
    expect(result).not.toBe(original);
    expect(result.first).not.toBe(shared);
    expect(result.first).toBe(result.second);
    expect(result.self).toBe(result);
  });

  it("uses stock serialization for special values instead of JSON or structuredClone", async () => {
    const value = {
      nan: NaN,
      negativeZero: -0,
      infinity: Infinity,
      negativeInfinity: -Infinity,
      bigint: 123n,
      absent: undefined,
      date: new Date("2024-01-02T00:00:00Z"),
      url: new URL("https://example.com/"),
      regexp: /hello/gi,
      bytes: new Uint16Array([1, 65535]),
      buffer: new Uint8Array([2, 4]).buffer,
      map: new Map([["key", "value"]]),
    };
    const result = await createPage().evaluate((value) => value, value);
    expect(result).toEqual({ ...value, map: {}, buffer: {} });
    expect("absent" in result).toBe(true);
    expect(Object.is(result.negativeZero, -0)).toBe(true);
    expect(result.bytes).not.toBe(value.bytes);
    expect(result.buffer).not.toBe(value.buffer);
  });

  it("awaits promises and normalizes callback failures like Playwright", async () => {
    const page = createPage();
    await expect(
      page.evaluate((value) => Promise.resolve(value), { n: 3 })
    ).resolves.toEqual({ n: 3 });
    await expect(
      page.evaluate(() => {
        throw new TypeError("bad callback");
      })
    ).rejects.toMatchObject({
      name: "Error",
      message: expect.stringContaining("TypeError: bad callback"),
    });
    await expect(
      page.evaluate(() => Promise.reject("rejected callback"))
    ).rejects.toThrow("rejected callback");
    await expect(
      page.evaluate(() => {
        throw 123;
      })
    ).rejects.toThrow("123");
  });

  it("supports string expressions and method shorthand without invoking returned functions", async () => {
    const page = createPage();
    const callbacks = {
      sum([a, b]: number[]) {
        return a + b;
      },
    };
    await expect(page.evaluate(callbacks.sum, [2, 3])).resolves.toBe(5);
    await expect(page.evaluate("1 + 2")).resolves.toBe(3);
    await expect(page.evaluate("(() => 42)")).resolves.toBeUndefined();
    document.body.innerHTML = "<button>Go</button>";
    await expect(page.locator("button").evaluate("42")).resolves.toBe(42);
  });

  it("rejects unsupported exposed functions before invoking user code", async () => {
    const page = createPage();
    await expect(
      (page as any).evaluate(
        () => {
          (window as any).__evaluationCalls = 1;
        },
        undefined,
        { exposeFunctions: true }
      )
    ).rejects.toThrow("Unsupported Playwright option");
    expect((window as any).__evaluationCalls).toBeUndefined();
    await expect(
      (page as any).evaluate(() => 1, undefined, undefined, 4)
    ).rejects.toThrow("Too many arguments");
  });

  it("rejects function-valued arguments through the stock client serializer", async () => {
    const page = createPage();
    await expect(
      page.evaluate((value) => value, { nested: { callback: () => 1 } })
    ).rejects.toThrow("Attempting to serialize unexpected value");
  });

  it("runs Page.$eval against current-document elements", async () => {
    document.body.innerHTML = "<p>A</p><p>B</p>";
    const page = createPage();

    await expect(
      (page as any).$eval(
        "p:first-child",
        (element: Element, suffix: string) => element.textContent + suffix,
        "!"
      )
    ).resolves.toBe("A!");
    await expect(
      (page as any).$eval("p", (element: Element) => element.textContent)
    ).resolves.toBe("A");
  });

  it("uses a native element handle as a page evaluation argument", async () => {
    document.body.innerHTML = '<div id="target">before</div>';
    const page = createPage();
    const target = await page.$("#target");
    if (!target) throw new Error("Expected target ElementHandle");

    await expect(
      page.evaluate((element: Element) => element.textContent, target)
    ).resolves.toBe("before");
  });
});
