/* eslint-disable @typescript-eslint/no-explicit-any -- Exercise runtime validation outside TypeScript's accepted inputs. */
import { afterEach, expect, it } from "vitest";

import { createPage } from "./index";

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any).__evaluationCalls;
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

it("serializes DOM returns for every supported target evaluation entry point", async () => {
  document.body.innerHTML = '<section id="root"><button>Go</button></section>';
  const page = createPage();
  const root = await page.$("#root");
  if (!root) throw new Error("Missing test root");
  const single = [
    () => page.evaluate(() => document.body),
    () => page.$eval("button", (element) => element),
    () => page.locator("button").evaluate((element) => element),
    () => root.evaluate((element) => element),
    () => root.$eval("button", (element) => element),
  ];
  for (const evaluate of single)
    await expect(evaluate()).resolves.toBe("ref: <Node>");
  const many = [
    () => page.$$eval("button", (elements) => elements),
    () => page.locator("button").evaluateAll((elements) => elements),
    () => root.$$eval("button", (elements) => elements),
  ];
  for (const evaluate of many)
    await expect(evaluate()).resolves.toEqual(["ref: <Node>"]);
  await expect(page.evaluate(() => [window, document])).resolves.toEqual([
    "ref: <Window>",
    "ref: <Document>",
  ]);
  await root.dispose();
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

it("copies waitForFunction arguments once and jsonValue results on every read", async () => {
  const page = createPage();
  const original = { calls: 0 };
  const handle = await page.waitForFunction(
    (value) => {
      value.calls++;
      return value.calls >= 2 ? value : false;
    },
    original,
    { polling: 1, timeout: 200 }
  );
  const first: any = await handle.jsonValue();
  first.calls = 10;
  expect(await handle.jsonValue()).toEqual({ calls: 2 });
  expect(original.calls).toBe(0);
  await handle.dispose();
  await expect(handle.jsonValue()).rejects.toThrow(/disposed/i);
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

it("does not leak DOM values or closures through waitForFunction", async () => {
  const page = createPage();
  const node = await page.waitForFunction(() => document.body);
  await expect(node.jsonValue()).resolves.toBe("ref: <Node>");
  await node.dispose();
  const closureValue = 1;
  expect(closureValue).toBe(1);
  await expect(
    page.waitForFunction(() => closureValue, undefined, { timeout: 50 })
  ).rejects.toThrow("closureValue");
  await expect(
    page.waitForFunction(() => Promise.reject("stop waiting"), undefined, {
      timeout: 50,
    })
  ).rejects.toThrow("stop waiting");
});

it("rejects function-valued arguments through the stock client serializer", async () => {
  const page = createPage();
  await expect(
    page.evaluate((value) => value, { nested: { callback: () => 1 } })
  ).rejects.toThrow("Attempting to serialize unexpected value");
});
