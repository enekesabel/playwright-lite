import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

// Run this same caller against stock Playwright and directly against Lite in the
// browser. Identity checks happen before the driver's serialization boundary.
async function observe(page) {
  const original = { nested: { value: 1 } };
  const result = await page.evaluate((value) => {
    value.nested.value = 2;
    return value;
  }, original);
  const output = {
    originalUnchanged: original.nested.value === 1,
    resultCopied: result !== original && result.nested !== original.nested,
    resultValue: result.nested.value,
  };
  const shared = { value: 1 };
  const graph = { first: shared, second: shared };
  graph.self = graph;
  const copy = await page.evaluate((value) => value, graph);
  output.graph =
    copy !== graph &&
    copy.first !== shared &&
    copy.first === copy.second &&
    copy.self === copy;
  const special = await page.evaluate((value) => value, {
    nan: NaN,
    zero: -0,
    infinity: Infinity,
    negativeInfinity: -Infinity,
    bigint: 42n,
    date: new Date("2024-01-01T00:00:00Z"),
    url: new URL("https://example.com/"),
    regexp: /hello/gi,
    bytes: new Uint16Array([1, 65535]),
    absent: undefined,
    buffer: new Uint8Array([2, 3]).buffer,
    map: new Map([["x", 1]]),
  });
  output.special = [
    Number.isNaN(special.nan),
    Object.is(special.zero, -0),
    special.infinity === Infinity,
    special.negativeInfinity === -Infinity,
    special.bigint === 42n,
    special.date instanceof Date,
    special.url instanceof URL,
    special.regexp instanceof RegExp,
    special.bytes instanceof Uint16Array,
    special.bytes[1] === 65535,
    "absent" in special,
    Object.getPrototypeOf(special.buffer) === Object.prototype &&
      Object.keys(special.buffer).length === 0,
    Object.getPrototypeOf(special.map) === Object.prototype &&
      Object.keys(special.map).length === 0,
  ];
  const root = await page.$("#root");
  const single = [
    () => page.evaluate(() => document.body),
    () => page.$eval("button", (element) => element),
    () => page.locator("button").evaluate((element) => element),
    () => root.evaluate((element) => element),
    () => root.$eval("button", (element) => element),
  ];
  const many = [
    () => page.$$eval("button", (elements) => elements),
    () => page.locator("button").evaluateAll((elements) => elements),
    () => root.$$eval("button", (elements) => elements),
  ];
  output.nodes = [];
  for (const operation of single)
    output.nodes.push((await operation()) === "ref: <Node>");
  for (const operation of many) {
    const nodes = await operation();
    output.nodes.push(
      Array.isArray(nodes) && nodes.length === 1 && nodes[0] === "ref: <Node>"
    );
  }
  const nested = { container: { handles: [root], count: 0 } };
  output.nestedHandle = await page.evaluate((value) => {
    value.container.count = 1;
    return value.container.handles[0].id;
  }, nested);
  output.nestedCopied = nested.container.count === 0;
  const onlyInCaller = 42;
  try {
    await page.evaluate(() => onlyInCaller);
    output.closureRejected = false;
  } catch (error) {
    output.closureRejected = error.message.includes("onlyInCaller");
  }
  output.callerValue = onlyInCaller;
  output.errors = [];
  for (const callback of [
    () => {
      throw new TypeError("probe failure");
    },
    () => Promise.reject("probe failure"),
  ]) {
    try {
      await page.evaluate(callback);
      output.errors.push(null);
    } catch (error) {
      output.errors.push({
        name: error.name,
        message: error.message.includes("probe failure"),
      });
    }
  }
  const waitArgument = { calls: 0 };
  const handle = await page.waitForFunction(
    (value) => {
      value.calls++;
      return value.calls >= 2 ? value : false;
    },
    waitArgument,
    { polling: 1, timeout: 1000 }
  );
  const first = await handle.jsonValue();
  first.calls = 20;
  output.wait = {
    original: waitArgument.calls,
    value: (await handle.jsonValue()).calls,
  };
  const primitiveHandle = await page.waitForFunction(() => 1);
  output.primitiveBeforeDisposal = await primitiveHandle.jsonValue();
  output.disposedHandles = [];
  for (const disposable of [handle, primitiveHandle]) {
    await disposable.dispose();
    const observed = [];
    for (const operation of [
      () => disposable.jsonValue(),
      () => page.evaluate((value) => value, { handle: disposable }),
    ]) {
      try {
        await operation();
        observed.push(false);
      } catch {
        observed.push(true);
      }
    }
    await disposable.dispose();
    output.disposedHandles.push(observed);
  }
  await root.dispose();
  return output;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(resolve(tmpdir(), "playwright-lite-evaluation-"));
let browser;
try {
  const bundle = resolve(temporary, "runtime.js");
  await build({
    entryPoints: [resolve(root, "dist/index.mjs")],
    outfile: bundle,
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "evaluationRuntime",
  });
  browser = await chromium.launch({ headless: true });
  const stock = await browser.newPage();
  const lite = await browser.newPage();
  const html = '<section id="root"><button>Go</button></section>';
  await stock.setContent(html);
  await lite.setContent(html);
  const expected = await observe(stock);
  assert.equal(expected.originalUnchanged, true);
  assert.equal(expected.resultCopied, true);
  assert.equal(expected.graph, true);
  assert.ok(expected.special.every(Boolean));
  assert.ok(expected.nodes.every(Boolean));
  assert.equal(expected.primitiveBeforeDisposal, 1);
  assert.deepEqual(expected.disposedHandles, [
    [true, true],
    [true, true],
  ]);
  await lite.addScriptTag({ path: bundle });
  const actual = await lite.evaluate((source) => {
    const run = globalThis.eval(`(${source})`);
    return run(globalThis.evaluationRuntime.createPage());
  }, String(observe));
  console.log("Stock observations:", expected);
  console.log("Lite observations:", actual);
  assert.deepEqual(actual, expected);
  console.log(
    "Evaluation parity passed against stock Playwright 1.62.1: argument/result copies, object graphs, special values, all target entry points, nested handles, closures, errors, waitForFunction jsonValue, and object/primitive handle disposal."
  );
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
