/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage, expect as browserExpect } from "../../src/index";
import { PageImpl } from "../../src/page";

// Playwright's own `expect(locator)` matchers are the caller of these
// Playwright-private-shaped hooks (`_expect`, `_evaluateExpression`,
// `_waitForFunctionExpression`), so they are a real interface. The vitest
// browser setup cannot load Playwright's own matcher runtime, so the hooks
// are exercised directly here instead of through `expect(locator)`.

describe("Locator._expect", () => {
  const expectedText = (value: string) => [
    { string: value, normalizeWhiteSpace: true },
  ];

  it("retries InjectedScript checks until the expectation succeeds", async () => {
    document.body.innerHTML = '<div id="target">before</div>';
    const page = createPage();
    window.setTimeout(() => {
      document.getElementById("target")!.textContent = "after";
    }, 25);

    const result = await (page.locator("#target") as any)._expect(
      "to.have.text",
      { expectedText: expectedText("after"), timeout: 200 }
    );

    expect(result.matches).toBe(true);
    expect(result.timedOut).toBeUndefined();
  });

  it("parses ARIA matcher templates before invoking InjectedScript", async () => {
    document.body.innerHTML = "<h1>Accessible title</h1>";
    const page = createPage();

    const result = await (page.locator("body") as any)._expect(
      "to.match.aria",
      {
        expectedValue: '- heading "Accessible title" [level=1]',
        timeout: 40,
      }
    );

    expect(result).toMatchObject({ matches: true });
    expect(result.timedOut).toBeUndefined();
  });

  it("reports a positive missing-element expectation as a timeout", async () => {
    const page = createPage();

    const result = await (page.locator("#missing") as any)._expect(
      "to.have.text",
      { expectedText: expectedText("expected"), timeout: 40 }
    );

    expect(result).toMatchObject({
      matches: false,
      timedOut: true,
      errorMessage: "Error: element(s) not found",
    });
    expect(result.log).toEqual(['waiting for locator("#missing")']);
  });

  it("allows a missing locator to satisfy a negated visible expectation", async () => {
    const page = createPage();

    const result = await (page.locator("#missing") as any)._expect(
      "to.be.visible",
      { isNot: true, timeout: 1 }
    );

    // Client matchers compare this with !isNot, so false is a successful
    // `expect(locator).not.toBeVisible()` result.
    expect(result).toMatchObject({ matches: false });
    expect(result.timedOut).toBeUndefined();
  });

  it("aborts a pending expectation without reporting a timeout", async () => {
    const page = createPage();
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(new Error("stop it")), 10);

    const result = await (page.locator("#missing") as any)._expect(
      "to.have.text",
      {
        expectedText: expectedText("expected"),
        timeout: 200,
        signal: controller.signal,
      }
    );

    expect(result).toMatchObject({
      matches: false,
      errorMessage: "Error: The assertion was aborted: stop it",
    });
    expect(result.timedOut).toBeUndefined();
  });
});

describe("Page._evaluateExpression", () => {
  it("evaluates a stringified function with arg (isFunction=true via bridge)", async () => {
    const page = createPage();
    const fn = (x: number) => x + 10;
    // Simulate bridge transport: String(fn) + explicit isFunction.
    const result = await (page as any)._evaluateExpression(String(fn), true, 5);
    expect(result).toBe(15);
  });

  it("string + isFunction=false returns expression value, not function", async () => {
    const page = createPage();
    // '(() => 42)' as a non-function expression evaluates to the
    // function object, but isFunction=false means it is not called.
    const result = await (page as any)._evaluateExpression("1 + 2", false);
    expect(result).toBe(3);
  });
});

describe("Page._waitForFunctionExpression", () => {
  it("evaluates interval callback source in the controlled window", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const page = new PageImpl(
      iframe.contentWindow! as Window & typeof globalThis
    );
    const pageWindow = page.window as typeof window & {
      __waitForFunctionCalls?: number;
      builtins?: { Date: DateConstructor };
    };
    pageWindow.builtins = { Date: pageWindow.Date };

    try {
      const handle = await page._waitForFunctionExpression(
        `() => {
            window.__waitForFunctionCalls =
              (window.__waitForFunctionCalls || 0) + 1;
            return window.builtins.Date.now() &&
              window.__waitForFunctionCalls >= 2
              ? window.__waitForFunctionCalls
              : false;
          }`,
        true,
        undefined,
        { polling: 1 }
      );
      const calls = await handle.jsonValue();

      await new Promise((resolve) => pageWindow.setTimeout(resolve, 20));
      expect(pageWindow.__waitForFunctionCalls).toBe(calls);
    } finally {
      iframe.remove();
    }
  });

  it("cleans up interval polling after predicate rejection", async () => {
    const page = createPage() as unknown as PageImpl;
    (
      window as typeof window & { __waitForFunctionRejects?: number }
    ).__waitForFunctionRejects = 0;

    await expect(
      page._waitForFunctionExpression(
        `() => {
            window.__waitForFunctionRejects =
              (window.__waitForFunctionRejects || 0) + 1;
            throw new Error("stop polling");
          }`,
        true,
        undefined,
        { polling: 1 }
      )
    ).rejects.toThrow("stop polling");

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(
      (window as typeof window & { __waitForFunctionRejects?: number })
        .__waitForFunctionRejects
    ).toBe(1);
    delete (window as typeof window & { __waitForFunctionRejects?: number })
      .__waitForFunctionRejects;
  });
});

describe("public expect", () => {
  it("supports equality, deep asymmetric matching, and negation", () => {
    browserExpect(2 + 2).toBe(4);
    browserExpect({
      name: "Ada Lovelace",
      roles: ["author", "mathematician"],
    }).toEqual({
      name: browserExpect.stringContaining("Lovelace"),
      roles: browserExpect.arrayContaining(["mathematician"]),
    });
    browserExpect({ enabled: true }).not.toEqual({ enabled: false });
  });

  it("supports promise modifiers", async () => {
    await browserExpect(Promise.resolve({ answer: 42 })).resolves.toEqual({
      answer: 42,
    });
    await browserExpect(Promise.reject(new Error("offline"))).rejects.toThrow(
      "offline"
    );
  });

  it("includes a custom message on failure", () => {
    expect(() => browserExpect(1, "expected answer").toBe(2)).toThrow(
      /expected answer[\s\S]*Expected: 2[\s\S]*Received: 1/
    );
  });

  it("supports custom matchers and configured timeouts", () => {
    const extended = browserExpect.extend({
      toBeWithin(received: unknown, floor: number, ceiling: number) {
        const pass =
          typeof received === "number" &&
          received >= floor &&
          received <= ceiling;
        return {
          pass,
          message: () => `${String(received)} is outside the range`,
        };
      },
      toUseTimeout(_received: unknown, expected: number) {
        return {
          pass: this.timeout === expected,
          message: () => `received timeout ${this.timeout}`,
        };
      },
    });

    extended(5).toBeWithin(1, 10);
    extended.configure({ timeout: 17 })(null).toUseTimeout(17);
  });

  it("polls until success and reports the last failure on timeout", async () => {
    let value = 0;
    await browserExpect
      .poll(() => ++value, { timeout: 200, intervals: [0] })
      .toBe(3);

    await expect(
      browserExpect
        .poll(() => "waiting", { timeout: 20, intervals: [0] })
        .toBe("ready")
    ).rejects.toThrow(
      /Expected: "ready"[\s\S]*Received: "waiting"[\s\S]*Timeout 20ms exceeded/
    );
  });

  it("applies negation while polling", async () => {
    let value = 0;
    await browserExpect
      .poll(() => ++value, { timeout: 200, intervals: [0] })
      .not.toBeLessThan(3);
    expect(value).toBe(3);
  });

  it("does not retry a polling callback that throws", async () => {
    let attempts = 0;
    await expect(
      browserExpect
        .poll(() => {
          attempts++;
          throw new Error("predicate failed");
        })
        .toBe("ready")
    ).rejects.toThrow("predicate failed");
    expect(attempts).toBe(1);
  });

  it("retries toPass callbacks and times out with the last failure", async () => {
    let attempts = 0;
    await browserExpect(() => {
      browserExpect(++attempts).toBe(3);
    }).toPass({ timeout: 200, intervals: [0] });

    await expect(
      browserExpect(() => browserExpect("actual").toBe("expected")).toPass({
        timeout: 20,
        intervals: [0],
      })
    ).rejects.toThrow(
      /Expected: "expected"[\s\S]*Received: "actual"[\s\S]*Timeout 20ms exceeded/
    );
  });

  it("rejects soft assertions without a test failure owner", () => {
    expect(() => (browserExpect as unknown as { soft: unknown }).soft).toThrow(
      "Soft assertions require Playwright Test's failure-reporting context"
    );
    expect(() =>
      (
        browserExpect.configure as unknown as (options: {
          soft: boolean;
        }) => unknown
      )({ soft: true })
    ).toThrow(
      "Soft assertions require Playwright Test's failure-reporting context"
    );
  });
});
