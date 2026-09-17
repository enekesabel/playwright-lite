import { afterEach, describe, expect, it } from "vitest";

import { ADAPTER_TIMEOUT_ERROR } from "../../../src/errors";
import { createPage } from "../../../src/index";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("timeouts", () => {
  it("forwards explicit timeout through locator terminal actions", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    const locator = page.locator("#missing");
    const actions: [string, () => Promise<unknown>][] = [
      ["locator.click", () => locator.click({ timeout: 1 })],
      ["locator.fill", () => locator.fill("value", { timeout: 1 })],
      ["locator.press", () => locator.press("x", { timeout: 1 })],
      ["locator.clear", () => locator.clear({ timeout: 1 })],
      ["locator.hover", () => locator.hover({ timeout: 1 })],
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

  it("applies stored default timeouts to queries and waitForFunction", async () => {
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

    const waitForFunctionError = await page
      .waitForFunction(() => false)
      .catch((error) => error);
    expect(waitForFunctionError.name).toBe("TimeoutError");
    expect(waitForFunctionError[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(waitForFunctionError.message).toBe(
      "page.waitForFunction: Timeout 20ms exceeded."
    );
  });
});
