/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
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
