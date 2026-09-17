/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { AdapterJSHandle } from "../../src/evaluation";
import { createPage } from "../../src/index";

describe("Page.waitForFunction", () => {
  it("resolves immediately with AdapterJSHandle", async () => {
    const page = createPage();
    const handle = await (page as any).waitForFunction(() => 42);
    expect(handle).toBeInstanceOf(AdapterJSHandle);
    expect(await handle.jsonValue()).toBe(42);
  });

  it("polls until the predicate becomes truthy", async () => {
    const page = createPage();
    (window as any).__wffCalls = 0;
    const handle = await (page as any).waitForFunction(
      () => {
        (window as any).__wffCalls++;
        return (window as any).__wffCalls >= 3 ? (window as any).__wffCalls : 0;
      },
      undefined,
      { polling: 10 }
    );
    expect(await handle.jsonValue()).toBeGreaterThanOrEqual(3);
  });

  it("rejects on timeout (including never-settling predicates)", async () => {
    const page = createPage();
    await expect(
      (page as any).waitForFunction(() => false, undefined, {
        polling: 10,
        timeout: 50,
      })
    ).rejects.toThrow(/[Tt]imeout/);
  });

  it("function reference: evals once, calls each poll", async () => {
    const page = createPage();
    (window as any).__wffCalls = 0;
    const fn = () => {
      (window as any).__wffCalls++;
      return (window as any).__wffCalls >= 2 ? "done" : "";
    };
    const handle = await (page as any).waitForFunction(fn, undefined, {
      polling: 10,
    });
    expect(await handle.jsonValue()).toBe("done");
  });

  it("string expression (isFunction=false) re-evaluates each poll", async () => {
    // A non-function string expression is evaled fresh each poll.
    // We can verify by using a (window as any).__wffCalls on the window.
    (window as any).__wffCounter = 0;
    const page = createPage();
    const handle = await (page as any).waitForFunction(
      "++window.__wffCounter >= 3 ? window.__wffCounter : 0",
      undefined,
      { polling: 10 }
    );
    expect(await handle.jsonValue()).toBeGreaterThanOrEqual(3);
    delete (window as any).__wffCounter;
  });

  it("passes arg to the predicate", async () => {
    const page = createPage();
    const handle = await (page as any).waitForFunction(
      (x: number) => (x > 0 ? x : 0),
      5
    );
    expect(await handle.jsonValue()).toBe(5);
  });

  it("validates polling option: rejects non-positive number", async () => {
    const page = createPage();
    await expect(
      (page as any).waitForFunction(() => true, undefined, { polling: 0 })
    ).rejects.toThrow(/non-positive/);
    await expect(
      (page as any).waitForFunction(() => true, undefined, {
        polling: -1,
      })
    ).rejects.toThrow(/non-positive/);
  });

  it("validates polling option: rejects unknown string", async () => {
    const page = createPage();
    await expect(
      (page as any).waitForFunction(() => true, undefined, {
        polling: "mutation" as any,
      })
    ).rejects.toThrow(/Unknown polling/);
  });

  it("cleans up timers after resolve", async () => {
    const page = createPage();
    (window as any).__wffCalls = 0;
    const handle = await (page as any).waitForFunction(
      () => {
        (window as any).__wffCalls++;
        return (window as any).__wffCalls >= 2 ? (window as any).__wffCalls : 0;
      },
      undefined,
      { polling: 10 }
    );
    const val = await handle.jsonValue();
    // Wait a bit — (window as any).__wffCalls should NOT keep incrementing after resolve.
    await new Promise((r) => setTimeout(r, 50));
    expect((window as any).__wffCalls).toBe(val);
    delete (window as any).__wffCalls;
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

  it("uses a native element handle as a waitForFunction argument", async () => {
    document.body.innerHTML = '<div id="target">before</div>';
    const page = createPage();
    const target = await page.$("#target");
    if (!target) throw new Error("Expected target ElementHandle");

    const waiting = page.waitForFunction(
      (element: Element) => element.textContent === "after",
      target,
      { polling: 1, timeout: 100 }
    );
    target.evaluate((element: Element) => (element.textContent = "after"));
    await expect(waiting).resolves.toBeTruthy();
  });
});
