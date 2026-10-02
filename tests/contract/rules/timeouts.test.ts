import { afterEach, describe, expect, it } from "vitest";

import { ADAPTER_TIMEOUT_ERROR } from "../../../src/errors";
import { createPage, expect as browserExpect } from "../../../src/index";
import { pendingFont } from "../fonts";
import { prepareTraversal } from "../history";
import { emulateTouch } from "../touch";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("timeouts", () => {
  it("forwards explicit timeout through locator terminal actions", async () => {
    document.body.innerHTML = "";
    emulateTouch();
    const page = createPage();
    const locator = page.locator("#missing");
    const actions: [string, () => Promise<unknown>][] = [
      ["locator.click", () => locator.click({ timeout: 1 })],
      ["locator.fill", () => locator.fill("value", { timeout: 1 })],
      ["locator.press", () => locator.press("x", { timeout: 1 })],
      ["locator.clear", () => locator.clear({ timeout: 1 })],
      ["locator.hover", () => locator.hover({ timeout: 1 })],
      ["locator.tap", () => locator.tap({ timeout: 1 })],
      ["locator.dragTo", () => locator.dragTo(locator, { timeout: 1 })],
      ["locator.check", () => locator.check({ timeout: 1 })],
      ["locator.uncheck", () => locator.uncheck({ timeout: 1 })],
      ["locator.setChecked", () => locator.setChecked(true, { timeout: 1 })],
      [
        "locator.selectOption",
        () => locator.selectOption("value", { timeout: 1 }),
      ],
      ["locator.selectText", () => locator.selectText({ timeout: 1 })],
      [
        "locator.scrollIntoViewIfNeeded",
        () => locator.scrollIntoViewIfNeeded({ timeout: 1 }),
      ],
    ];

    for (const [apiName, action] of actions)
      await expect(action(), apiName).rejects.toThrow("Timeout 1ms exceeded");
  });

  it("preserves zero as an unbounded explicit locator action timeout", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    page.setDefaultTimeout(1);
    let clicks = 0;
    window.setTimeout(() => {
      document.body.innerHTML = '<button id="late">Late</button>';
      document
        .querySelector("#late")
        ?.addEventListener("click", () => clicks++);
    }, 25);

    await page.locator("#late").click({ timeout: 0 });
    expect(clicks).toBe(1);
  });

  it("applies stored default timeouts to queries, waitForFunction and waitForEvent", async () => {
    const page = createPage();
    page.setDefaultTimeout(20);

    await expect(page.innerText("#missing")).rejects.toThrow(
      "Timeout 20ms exceeded"
    );
    const waitForStateError = await page
      .locator("#missing")
      .waitFor()
      .catch((error) => error);
    expect(waitForStateError.name).toBe("TimeoutError");
    expect(waitForStateError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(waitForStateError.message).toContain("Timed out waiting");

    const actionError = await page.check("#missing").catch((error) => error);
    expect(actionError.name).toBe("TimeoutError");
    expect(actionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(actionError.message).toContain("Timeout 20ms exceeded");

    const locatorActionError = await page
      .locator("#missing-locator-action")
      .click()
      .catch((error) => error);
    expect(locatorActionError.name).toBe("TimeoutError");
    expect(locatorActionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(locatorActionError.message).toContain("Timeout 20ms exceeded");

    pendingFont(1_000);
    const screenshotError = await page.screenshot().catch((error) => error);
    expect(screenshotError.name).toBe("TimeoutError");
    expect(screenshotError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(screenshotError.message).toBe(
      "page.screenshot: Timeout 20ms exceeded.\nCall log:\n  - taking page screenshot\n  - waiting for fonts to load..."
    );

    const waitForFunctionError = await page
      .waitForFunction(() => false)
      .catch((error) => error);
    expect(waitForFunctionError.name).toBe("TimeoutError");
    expect(waitForFunctionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(waitForFunctionError.message).toBe(
      "page.waitForFunction: Timeout 20ms exceeded."
    );

    const waitForEventError = await page
      .waitForEvent("load")
      .catch((error) => error);
    expect(waitForEventError.name).toBe("TimeoutError");
    expect(waitForEventError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(waitForEventError.message).toBe(
      'page.waitForEvent: Timeout 20ms exceeded while waiting for event "load"'
    );

    const waitForRequestError = await page
      .waitForRequest("**/never")
      .catch((error) => error);
    expect(waitForRequestError.name).toBe("TimeoutError");
    expect(waitForRequestError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(waitForRequestError.message).toBe(
      'page.waitForRequest: Timeout 20ms exceeded while waiting for request "**/never"'
    );

    const waitForResponseError = await page
      .waitForResponse("**/never")
      .catch((error) => error);
    expect(waitForResponseError.name).toBe("TimeoutError");
    expect(waitForResponseError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(waitForResponseError.message).toBe(
      'page.waitForResponse: Timeout 20ms exceeded while waiting for response "**/never"'
    );
  });

  it("applies the navigation timeout to networkidle waits", async () => {
    // Network idle takes at least 500 ms, so 20 ms always runs out first.
    const page = createPage({ navigationTimeout: 20 });
    const waits: [string, () => Promise<unknown>][] = [
      ["page.waitForLoadState", () => page.waitForLoadState("networkidle")],
      [
        "page.waitForURL",
        () => page.waitForURL(location.href, { waitUntil: "networkidle" }),
      ],
      [
        "page.goto",
        () => page.goto("#networkidle-timeout", { waitUntil: "networkidle" }),
      ],
    ];

    for (const [apiName, wait] of waits)
      await expect(wait(), apiName).rejects.toThrow(
        `${apiName}: Timeout 20ms exceeded.`
      );
  });

  it("applies the navigation timeout to history traversal", async () => {
    // The traversal commits, then waits for a `load` that never comes.
    const page = createPage({ navigationTimeout: 20 });
    const traversals: [
      string,
      "back" | "forward",
      () => ReturnType<typeof page.goBack>,
    ][] = [
      ["page.goBack", "back", () => page.goBack()],
      ["page.goForward", "forward", () => page.goForward()],
    ];

    for (const [apiName, side, traverse] of traversals) {
      const restore = await prepareTraversal(side);
      try {
        const error = await traverse().catch((error) => error);
        expect(error.name, apiName).toBe("TimeoutError");
        expect(error[ADAPTER_TIMEOUT_ERROR], apiName).toBe(true);
        expect(error.message, apiName).toBe(
          `${apiName}: Timeout 20ms exceeded.`
        );
      } finally {
        restore();
      }
    }
  });
});

describe("timeout: 0", () => {
  // Every configured default is shorter than the delay, so only a wait
  // without a deadline sees its condition become true.
  const DEFAULT_TIMEOUT = 20;
  const DELAY = 100;
  type Options = { timeout: 0; signal?: AbortSignal };
  type Member = [string, (options: Options) => Promise<unknown>, () => void];

  /** Each member with the change that ends its wait. */
  function members(): Member[] {
    const page = createPage({
      actionTimeout: DEFAULT_TIMEOUT,
      navigationTimeout: DEFAULT_TIMEOUT,
    });
    const assert = browserExpect.configure({ timeout: DEFAULT_TIMEOUT });
    const target = page.locator("#target");
    const showTarget = () => {
      document.body.innerHTML = '<button id="target">Ready</button>';
    };
    const setTitle = () => {
      document.title = "Timeout zero";
    };
    const setHash = () => {
      location.hash = "timeout-zero";
    };
    return [
      [
        "expect(locator).toBeVisible",
        (o) => assert(target).toBeVisible(o),
        showTarget,
      ],
      [
        "expect(locator).toHaveText",
        (o) => assert(target).toHaveText("Ready", o),
        showTarget,
      ],
      [
        "expect(locator).toHaveCount",
        (o) => assert(target).toHaveCount(1, o),
        showTarget,
      ],
      [
        "expect(locator).toMatchAriaSnapshot",
        (o) => assert(target).toMatchAriaSnapshot('- button "Ready"', o),
        showTarget,
      ],
      [
        "expect(page).toHaveTitle",
        (o) => assert(page).toHaveTitle("Timeout zero", o),
        setTitle,
      ],
      [
        "expect(page).toHaveURL",
        (o) => assert(page).toHaveURL(/#timeout-zero$/, o),
        setHash,
      ],
      ["locator.waitFor", (o) => target.waitFor(o), showTarget],
      [
        "page.waitForSelector",
        (o) => page.waitForSelector("#target", o),
        showTarget,
      ],
      [
        "page.waitForFunction",
        (o) =>
          page.waitForFunction(
            () => document.querySelector("#target"),
            undefined,
            o
          ),
        showTarget,
      ],
      ["page.waitForURL", (o) => page.waitForURL(/#timeout-zero$/, o), setHash],
      ["locator.click", (o) => target.click(o), showTarget],
      // A capture waits for its pending font, which loads after the delay.
      [
        "page.screenshot",
        (o) => {
          pendingFont(DELAY * 2);
          return page.screenshot(o);
        },
        () => {},
      ],
    ];
  }
  const names = members().map(([apiName]) => apiName);
  const member = (apiName: string) =>
    members().find(([name]) => name === apiName)!;

  afterEach(() => {
    document.title = "";
    history.replaceState(null, "", location.pathname + location.search);
  });

  it.each(names)(
    "%s waits past the default until its condition holds",
    async (apiName) => {
      const [, run, settle] = member(apiName);
      const timer = window.setTimeout(settle, DELAY);
      try {
        await run({ timeout: 0 });
      } finally {
        window.clearTimeout(timer);
      }
    }
  );

  it.each(names)("%s still ends on abort", async (apiName) => {
    const [, run] = member(apiName);
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(new Error("stop waiting")), DELAY);
    await expect(
      run({ timeout: 0, signal: controller.signal })
    ).rejects.toThrow("stop waiting");
  });
});
