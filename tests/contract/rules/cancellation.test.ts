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
});
