/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it } from "vitest";

import { createPage, expect as browserExpect } from "../../src/index";
import { PageImpl } from "../../src/page";

describe("expect(locator)", () => {
  it("keeps Locator assertions out of ordinary expectations at type level", () => {
    const locator = createPage().locator("body");
    const typeOnly = (condition: boolean) => {
      if (!condition) return;
      browserExpect(locator).toHaveText("body");
      // @ts-expect-error Locator assertions are not generic value matchers.
      browserExpect(1).toBeVisible();
      // @ts-expect-error ignoreCase is not a toHaveId option.
      browserExpect(locator).toHaveId("body", { ignoreCase: true });
      // @ts-expect-error Locator role expectations use Playwright's ARIA role union.
      browserExpect(locator).toHaveRole("not-an-aria-role");
    };
    typeOnly(false);
  });

  it("retries and exposes state, text, count, value, attribute, and accessibility assertions", async () => {
    document.body.innerHTML = `
      <button id="button" class="primary active" aria-label="Publish" aria-description="Publishes this draft">Publish</button>
      <input id="check" type="checkbox"><input id="unchecked" type="checkbox"><input id="value" value="Ready" data-state="ready" readonly>
      <input id="disabled" disabled><div id="empty"></div><div id="hidden" hidden></div><div id="property"></div>
      <input id="error" role="textbox" aria-invalid="true" aria-errormessage="message"><div id="message">Required</div>
      <select id="select" multiple><option selected value="a">A</option><option selected value="b">B</option></select>
      <ul><li>First item</li><li>Second item</li></ul><div id="target">before<span hidden> hidden</span></div>`;
    const page = createPage();
    const check = document.querySelector<HTMLInputElement>("#check")!;
    check.indeterminate = true;
    (
      document.getElementById("property") as HTMLElement & { state?: unknown }
    ).state = { ready: true };
    (document.getElementById("button") as HTMLButtonElement).focus();
    window.setTimeout(() => {
      document.getElementById("target")!.firstChild!.textContent = "after";
    }, 25);

    await browserExpect(page.locator("#button")).toBeAttached();
    await browserExpect(page.locator("#missing")).toBeAttached({
      attached: false,
    });
    await browserExpect(page.locator("#button")).toBeVisible();
    await browserExpect(page.locator("#button")).toBeEnabled();
    await browserExpect(page.locator("#disabled")).toBeDisabled();
    await browserExpect(page.locator("#disabled")).toBeEnabled({
      enabled: false,
    });
    await browserExpect(page.locator("#value")).toBeEditable({
      editable: false,
    });
    await browserExpect(page.locator("#empty")).toBeEmpty();
    await browserExpect(page.locator("#button")).toBeFocused();
    await browserExpect(page.locator("#hidden")).toBeHidden();
    await browserExpect(page.locator("#hidden")).toBeVisible({
      visible: false,
    });
    await browserExpect(page.locator("#check")).toBeChecked({
      indeterminate: true,
    });
    await browserExpect(page.locator("#unchecked")).not.toBeChecked();
    await browserExpect(page.locator("#button")).toBeInViewport({ ratio: 0 });
    await browserExpect(page.locator("#target")).toHaveText("after", {
      timeout: 200,
      useInnerText: true,
    });
    await browserExpect(page.locator("li")).toContainText(["First", "Second"]);
    await browserExpect(page.locator("li")).toHaveClass(["", ""]);
    await browserExpect(page.locator("#button")).toContainClass(
      "active primary"
    );
    await browserExpect(page.locator("li")).toHaveCount(2);
    await browserExpect(page.locator("#value")).toHaveAttribute(
      "data-state",
      "READY",
      { ignoreCase: true }
    );
    await browserExpect(page.locator("#value")).toHaveValue("Ready");
    await browserExpect(page.locator("#select")).toHaveValues(["a", "b"]);
    await browserExpect(page.locator("#button")).toHaveAccessibleName(
      "publish",
      { ignoreCase: true }
    );
    await browserExpect(page.locator("#button")).toHaveAccessibleDescription(
      "Publishes this draft"
    );
    await browserExpect(page.locator("#error")).toHaveAccessibleErrorMessage(
      "Required"
    );
    await browserExpect(page.locator("#button")).toHaveRole("button");
    await browserExpect(page.locator("#button")).toHaveId("button");
    await browserExpect(page.locator("#button")).toHaveCSS(
      "display",
      "inline-block"
    );
    await browserExpect(page.locator("#property")).toHaveJSProperty("state", {
      ready: true,
    });
  });

  it("supports negation, missing elements, ARIA text, cancellation, and representative failures", async () => {
    document.body.innerHTML =
      '<h1>Accessible title</h1><div id="value">actual</div>';
    const page = createPage();
    await browserExpect(page.locator("#missing")).not.toBeVisible();
    await browserExpect(page.locator("body")).toMatchAriaSnapshot(
      '- heading "Accessible title" [level=1]'
    );

    const controller = new AbortController();
    window.setTimeout(() => controller.abort("stop it"), 10);
    await expect(
      browserExpect(page.locator("#missing")).toHaveText("expected", {
        timeout: 200,
        signal: controller.signal,
      })
    ).rejects.toThrow("The assertion was aborted: stop it");
    await expect(
      browserExpect(page.locator("#value"), "custom message").toHaveText(
        "expected",
        { timeout: 20 }
      )
    ).rejects.toThrow(
      /custom message[\s\S]*expect\(locator\)\.toHaveText\(expected\) failed[\s\S]*Expected:[\s\S]*Received:[\s\S]*Timeout: +20ms[\s\S]*Call log:/
    );
  });

  it("uses the locator brand and preserves pinned failure diagnostics", async () => {
    const fakeLocator = {
      _expect: async () => ({ matches: true }),
      toString: () => "fake",
    };
    expect((browserExpect(fakeLocator) as any).toBeVisible).toBeUndefined();

    document.body.innerHTML =
      '<input id="check" type="checkbox"><h1>Title</h1>';
    const page = createPage();
    const error = (await browserExpect(page.locator("#check"))
      .toBeChecked({ timeout: 20 })
      .catch(
        (reason: Error & { matcherResult?: Record<string, unknown> }) => reason
      )) as Error & { matcherResult?: Record<string, unknown> };
    expect(error.message).toContain("Received: unchecked");
    expect(error.message).toContain('Expect "toBeChecked" with timeout 20ms');
    expect(error.message).toContain("locator resolved to <input");
    expect(error.message).toContain('unexpected value "unchecked"');
    expect(error.matcherResult?.timeout).toBe(20);
    expect(error.matcherResult?.log).toEqual(
      expect.arrayContaining([
        'Expect "toBeChecked" with timeout 20ms',
        'unexpected value "unchecked"',
      ])
    );

    const ariaError = (await browserExpect(page.locator("body"))
      .toMatchAriaSnapshot(
        `
        - heading "Other" [level=1]
      `,
        { timeout: 20 }
      )
      .catch(
        (reason: Error & { matcherResult?: Record<string, unknown> }) => reason
      )) as Error & { matcherResult?: Record<string, unknown> };
    expect(ariaError.matcherResult?.actual).toContain('heading "Title"');
    expect(ariaError.matcherResult).toHaveProperty("ariaSnapshot");
  });

  it("rejects invalid scalar text expectations before querying the document", async () => {
    document.body.innerHTML = '<div id="UPPER"></div>';
    const locator = createPage().locator("#missing");
    await expect(
      (browserExpect(locator) as any).toHaveText(42)
    ).rejects.toThrow("expected value must be a string or regular expression");
    await expect(
      (browserExpect(locator) as any).toHaveCSS("display", 42)
    ).rejects.toThrow("expected value must be a string or regular expression");
    await expect(
      (browserExpect(createPage().locator("div")) as any).toHaveId("upper", {
        ignoreCase: true,
        timeout: 20,
      })
    ).rejects.toThrow('Expected: "upper"');
  });

  it("allows an extended matcher to override a Locator matcher name", async () => {
    const extended = browserExpect.extend({
      toHaveText(_received: unknown, expected: string) {
        return { pass: expected === "custom", message: () => "custom text" };
      },
    });

    await extended(createPage().locator("#missing")).toHaveText("custom");
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

  it("expect.extend should be immutable", () => {
    const calls: string[] = [];
    const expectFoo = browserExpect.extend({
      toFoo() {
        calls.push("foo");
        return { pass: true, message: () => "" };
      },
    });
    const expectFoo2 = browserExpect.extend({
      toFoo() {
        calls.push("foo2");
        return { pass: true, message: () => "" };
      },
    });
    const expectBar = expectFoo.extend({
      toBar() {
        calls.push("bar");
        return { pass: true, message: () => "" };
      },
    });

    expectFoo(undefined).toFoo();
    expectFoo2(undefined).toFoo();
    expectBar(undefined).toFoo();
    expectBar(undefined).toBar();

    expect(calls).toEqual(["foo", "foo2", "foo", "bar"]);
  });

  it("expect.extend should fall back to legacy behavior", () => {
    const calls: string[] = [];
    const legacyExpect = browserExpect.configure({});
    legacyExpect.extend({
      toFoo() {
        calls.push("foo");
        return { pass: true, message: () => "" };
      },
    });
    legacyExpect.extend({
      toFoo() {
        calls.push("foo2");
        return { pass: true, message: () => "" };
      },
    });
    legacyExpect.extend({
      toBar() {
        calls.push("bar");
        return { pass: true, message: () => "" };
      },
    });

    const legacyMatchers = legacyExpect(undefined) as unknown as {
      toBar(): void;
      toFoo(): void;
    };
    legacyMatchers.toFoo();
    legacyMatchers.toBar();

    expect(calls).toEqual(["foo2", "bar"]);
  });

  it("expect.extend should not override builtin matchers through legacy behavior", () => {
    let customCalls = 0;
    const legacyExpect = browserExpect.configure({});
    legacyExpect.extend({
      toBe() {
        customCalls++;
        return { pass: true, message: () => "" };
      },
    });

    expect(() => legacyExpect(1).toBe(2)).toThrow(/Expected: 2/);
    expect(customCalls).toBe(0);
  });

  it("awaits thenable custom matcher results", async () => {
    const extended = browserExpect.extend({
      toBeThenable(received: unknown, expected: unknown) {
        return {
          then(
            resolve: (result: { pass: boolean; message: () => string }) => void
          ) {
            resolve({
              pass: received === expected,
              message: () => "values differ",
            });
          },
        } as Promise<{ pass: boolean; message: () => string }>;
      },
    });

    await extended("same").toBeThenable("same");
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
    browserExpect.configure({ soft: false })(1).toBe(1);
  });

  it("matches Playwright toThrow stack formatting", () => {
    const thrown = new Error("boom");
    thrown.stack =
      "Error: boom\n    at thrower (example.js:10:2)\n    at caller (caller.js:20:3)";

    let message = "";
    try {
      browserExpect(() => {
        throw thrown;
      }).toThrow("other");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(
      'expect(received).toThrow(expected)\n\nExpected substring: "other"\nReceived message:   "boom"\n\n      at thrower (example.js:10:2)\n      at caller (caller.js:20:3)'
    );
  });

  it("matches Playwright rejects.toThrow AggregateError formatting", async () => {
    const first = new Error("first");
    first.stack = "Error: first\n    at one (one.js:1:2)";
    const second = new TypeError("second");
    second.stack = "TypeError: second\n    at two (two.js:3:4)";
    const aggregate = new AggregateError([first, second], "many");
    aggregate.stack =
      "AggregateError: many\n    at aggregate (aggregate.js:5:6)";

    let message = "";
    try {
      await browserExpect(Promise.reject(aggregate)).rejects.toThrow("other");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(
      'expect(received).rejects.toThrow(expected)\n\nExpected substring: "other"\nReceived message:   "many"\n  ● Test suite failed to run\n\n    AggregateError: many\n\n      at aggregate (aggregate.js:5:6)\n\n    Errors contained in AggregateError:\n     first\n\n          at one (one.js:1:2)\n\n     TypeError: second\n\n          at two (two.js:3:4)\n\n'
    );
  });
});
