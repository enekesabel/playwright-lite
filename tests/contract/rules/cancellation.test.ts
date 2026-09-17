import { describe, expect, it } from "vitest";

import { createPage } from "../../../src/index";

describe("cancellation", () => {
  it("aborts every action with a prefixed AbortError", async () => {
    document.body.innerHTML = "<select id=select><option>one</option></select>";
    const page = createPage();
    const locator = () => page.locator("#never");
    type Options = { signal: AbortSignal; timeout: number };
    const actions: [string, (options: Options) => Promise<unknown>][] = [
      ["page.check", (o) => page.check("#never", o)],
      ["page.click", (o) => page.click("#never", o)],
      ["page.dblclick", (o) => page.dblclick("#never", o)],
      ["page.dispatchEvent", (o) => page.dispatchEvent("#never", "x", {}, o)],
      ["page.fill", (o) => page.fill("#never", "x", o)],
      ["page.focus", (o) => page.focus("#never", o)],
      ["page.hover", (o) => page.hover("#never", o)],
      ["page.press", (o) => page.press("#never", "a", o)],
      ["page.selectOption", (o) => page.selectOption("#select", "x", o)],
      ["page.setChecked", (o) => page.setChecked("#never", true, o)],
      ["page.setInputFiles", (o) => page.setInputFiles("#never", [], o)],
      ["page.type", (o) => page.type("#never", "x", o)],
      ["page.uncheck", (o) => page.uncheck("#never", o)],
      ["page.waitForSelector", (o) => page.waitForSelector("#never", o)],
      ["locator.check", (o) => locator().check(o)],
      ["locator.clear", (o) => locator().clear(o)],
      ["locator.click", (o) => locator().click(o)],
      ["locator.dblclick", (o) => locator().dblclick(o)],
      ["locator.dispatchEvent", (o) => locator().dispatchEvent("x", {}, o)],
      ["locator.fill", (o) => locator().fill("x", o)],
      ["locator.focus", (o) => locator().focus(o)],
      ["locator.hover", (o) => locator().hover(o)],
      ["locator.press", (o) => locator().press("a", o)],
      ["locator.pressSequentially", (o) => locator().pressSequentially("x", o)],
      [
        "locator.scrollIntoViewIfNeeded",
        (o) => locator().scrollIntoViewIfNeeded(o),
      ],
      ["locator.selectOption", (o) => locator().selectOption("x", o)],
      ["locator.selectText", (o) => locator().selectText(o)],
      ["locator.setChecked", (o) => locator().setChecked(true, o)],
      ["locator.setInputFiles", (o) => locator().setInputFiles([], o)],
      ["locator.type", (o) => locator().type("x", o)],
      ["locator.uncheck", (o) => locator().uncheck(o)],
      ["locator.waitFor", (o) => locator().waitFor(o)],
    ];

    for (const [apiName, run] of actions) {
      for (const inFlight of [false, true]) {
        const reason = new Error("stop");
        const controller = new AbortController();
        if (inFlight) window.setTimeout(() => controller.abort(reason), 10);
        else controller.abort(reason);
        const error = await run({
          signal: controller.signal,
          timeout: 0,
        }).then(
          () => undefined,
          (error) => error
        );
        const context = `${apiName} ${inFlight ? "in-flight" : "pre-aborted"}`;
        expect(error?.name, context).toBe("AbortError");
        expect(error.message, context).toMatch(
          inFlight
            ? new RegExp(`^${apiName}: stop\\nCall log:`)
            : `${apiName}: The operation was aborted`
        );
        expect(error.cause, context).toBe(reason);
      }
    }
  });

  it("aborts every query with a prefixed AbortError", async () => {
    document.body.innerHTML = "<select id=select><option>one</option></select>";
    const page = createPage();
    const locator = () => page.locator("#never");
    type Options = { signal: AbortSignal; timeout: number };
    const queries: [string, (options: Options) => Promise<unknown>][] = [
      ["page.getAttribute", (o) => page.getAttribute("#never", "name", o)],
      ["page.innerHTML", (o) => page.innerHTML("#never", o)],
      ["page.innerText", (o) => page.innerText("#never", o)],
      ["page.inputValue", (o) => page.inputValue("#never", o)],
      ["page.isChecked", (o) => page.isChecked("#never", o)],
      ["page.isDisabled", (o) => page.isDisabled("#never", o)],
      ["page.isEditable", (o) => page.isEditable("#never", o)],
      ["page.isEnabled", (o) => page.isEnabled("#never", o)],
      ["page.textContent", (o) => page.textContent("#never", o)],
      ["locator.ariaSnapshot", (o) => locator().ariaSnapshot(o)],
      ["locator.blur", (o) => locator().blur(o)],
      ["locator.boundingBox", (o) => locator().boundingBox(o)],
      [
        "locator.evaluate",
        (o) =>
          locator().evaluate((element) => element.textContent, undefined, o),
      ],
      ["locator.getAttribute", (o) => locator().getAttribute("name", o)],
      ["locator.innerHTML", (o) => locator().innerHTML(o)],
      ["locator.innerText", (o) => locator().innerText(o)],
      ["locator.inputValue", (o) => locator().inputValue(o)],
      ["locator.isChecked", (o) => locator().isChecked(o)],
      ["locator.isDisabled", (o) => locator().isDisabled(o)],
      ["locator.isEditable", (o) => locator().isEditable(o)],
      ["locator.isEnabled", (o) => locator().isEnabled(o)],
      ["locator.textContent", (o) => locator().textContent(o)],
    ];

    for (const [apiName, run] of queries) {
      for (const inFlight of [false, true]) {
        const reason = new Error("stop");
        const controller = new AbortController();
        if (inFlight) window.setTimeout(() => controller.abort(reason), 10);
        else controller.abort(reason);
        const error = await run({
          signal: controller.signal,
          timeout: 0,
        }).then(
          () => undefined,
          (error) => error
        );
        const context = `${apiName} ${inFlight ? "in-flight" : "pre-aborted"}`;
        expect(error?.name, context).toBe("AbortError");
        expect(error.message, context).toMatch(
          inFlight
            ? new RegExp(`^${apiName}: stop\\nCall log:`)
            : `${apiName}: The operation was aborted`
        );
        expect(error.cause, context).toBe(reason);
      }
    }
  });
});
