import { describe, expect, it } from "vitest";

import { createPage } from "../../../src/index";
import { prepareTraversal, stubLoading } from "../history";

type Page = ReturnType<typeof createPage>;
type Options = { signal?: AbortSignal; timeout: number };
type Handle = NonNullable<Awaited<ReturnType<Page["$"]>>>;

const closedMessage = "Target page, context or browser has been closed";

/** Every action that waits, with the setup its wait needs. */
function actions(
  page: Page
): [
  string,
  (options: Options) => Promise<unknown>,
  (() => (() => void) | Promise<() => void>)?,
][] {
  const locator = () => page.locator("#never");
  return [
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
    [
      "page.waitForFunction",
      (o) => page.waitForFunction("false", undefined, o),
    ],
    [
      "page.waitForLoadState",
      (o) => page.waitForLoadState(undefined, o),
      stubLoading,
    ],
    ["page.waitForLoadState", (o) => page.waitForLoadState("networkidle", o)],
    ["page.waitForSelector", (o) => page.waitForSelector("#never", o)],
    ["page.waitForURL", (o) => page.waitForURL("**/*#never", o)],
    [
      "page.waitForURL",
      (o) => page.waitForURL(location.href, { ...o, waitUntil: "networkidle" }),
    ],
    ["page.waitForNavigation", (o) => page.waitForNavigation(o)],
    ["page.goBack", (o) => page.goBack(o), () => prepareTraversal("back")],
    [
      "page.goForward",
      (o) => page.goForward(o),
      () => prepareTraversal("forward"),
    ],
    ["page.waitForEvent", (o) => page.waitForEvent("load", o)],
    ["page.waitForRequest", (o) => page.waitForRequest("**/never", o)],
    ["page.waitForResponse", (o) => page.waitForResponse("**/never", o)],
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
}

/**
 * Every handle action. A handle already holds its element, so only the
 * members that wait for actionability can observe an abort raised after the
 * call started; the flag marks them.
 */
const handleActions: [
  string,
  (h: Handle, o: Options) => Promise<unknown>,
  boolean,
][] = [
  ["elementHandle.fill", (h, o) => h.fill("x", o), true],
  ["elementHandle.press", (h, o) => h.press("a", o), false],
  [
    "elementHandle.scrollIntoViewIfNeeded",
    (h, o) => h.scrollIntoViewIfNeeded(o),
    true,
  ],
  ["elementHandle.selectOption", (h, o) => h.selectOption("x", o), true],
  ["elementHandle.selectText", (h, o) => h.selectText(o), true],
  ["elementHandle.setInputFiles", (h, o) => h.setInputFiles([], o), false],
  ["elementHandle.type", (h, o) => h.type("x", o), false],
  [
    "elementHandle.waitForElementState",
    (h, o) => h.waitForElementState("visible", o),
    true,
  ],
  [
    "elementHandle.waitForSelector",
    (h, o) => h.waitForSelector("#never", o),
    true,
  ],
];

/** Every query that waits for its element. */
function queries(
  page: Page
): [string, (options: Options) => Promise<unknown>][] {
  const locator = () => page.locator("#never");
  return [
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
      (o) => locator().evaluate((element) => element.textContent, undefined, o),
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
}

async function settle(promise: Promise<unknown>) {
  return (await promise.then(
    () => undefined,
    (error) => error
  )) as (Error & { cause?: unknown }) | undefined;
}

/** Runs `run` with an abort raised before or after the call started. */
async function aborted(
  run: (options: Options) => Promise<unknown>,
  inFlight: boolean
) {
  const reason = new Error("stop");
  const controller = new AbortController();
  if (inFlight) window.setTimeout(() => controller.abort(reason), 10);
  else controller.abort(reason);
  return {
    reason,
    error: await settle(run({ signal: controller.signal, timeout: 0 })),
  };
}

/** Runs `run` without a timeout on `page`, closing the page mid-wait. */
async function closedDuring(page: Page, run: () => Promise<unknown>) {
  window.setTimeout(() => void page.close(), 10);
  return settle(run());
}

function expectAborted(
  apiName: string,
  inFlight: boolean,
  { reason, error }: Awaited<ReturnType<typeof aborted>>
) {
  const context = `${apiName} ${inFlight ? "in-flight" : "pre-aborted"}`;
  expect(error?.name, context).toBe("AbortError");
  expect(error?.message, context).toMatch(
    inFlight
      ? new RegExp(`^${apiName}: stop\\nCall log:`)
      : `${apiName}: The operation was aborted`
  );
  expect(error?.cause, context).toBe(reason);
}

function expectClosed(apiName: string, error: Error | undefined) {
  expect(error?.name, apiName).toBe("Error");
  expect(error?.message, apiName).toBe(`${apiName}: ${closedMessage}`);
}

describe("cancellation", () => {
  it("aborts every action with a prefixed AbortError", async () => {
    document.body.innerHTML = "<select id=select><option>one</option></select>";
    for (const [apiName, run, prepare] of actions(createPage())) {
      for (const inFlight of [false, true]) {
        const restore = await prepare?.();
        try {
          expectAborted(apiName, inFlight, await aborted(run, inFlight));
        } finally {
          restore?.();
        }
      }
    }
  });

  it("rejects every action with the closed error when the page closes", async () => {
    document.body.innerHTML = "<select id=select><option>one</option></select>";
    const count = actions(createPage()).length;
    for (let index = 0; index < count; index++) {
      const page = createPage();
      const [apiName, run, prepare] = actions(page)[index];
      const restore = await prepare?.();
      try {
        expectClosed(
          apiName,
          await closedDuring(page, () => run({ timeout: 0 }))
        );
      } finally {
        restore?.();
      }
    }
  });

  it("aborts every handle action with a prefixed AbortError", async () => {
    document.body.innerHTML = '<input id=hidden style="display:none" value=x>';
    const page = createPage();

    for (const [apiName, run, waits] of handleActions) {
      for (const inFlight of waits ? [false, true] : [false]) {
        const handle = (await page.$("#hidden"))!;
        expectAborted(
          apiName,
          inFlight,
          await aborted((o) => run(handle, o), inFlight)
        );
      }
    }
  });

  it("rejects every waiting handle action with the closed error when the page closes", async () => {
    document.body.innerHTML = '<input id=hidden style="display:none" value=x>';
    for (const [apiName, run, waits] of handleActions) {
      if (!waits) continue;
      const page = createPage();
      const handle = (await page.$("#hidden"))!;
      expectClosed(
        apiName,
        await closedDuring(page, () => run(handle, { timeout: 0 }))
      );
    }
  });

  it("aborts every query with a prefixed AbortError", async () => {
    document.body.innerHTML = "<select id=select><option>one</option></select>";
    for (const [apiName, run] of queries(createPage()))
      for (const inFlight of [false, true])
        expectAborted(apiName, inFlight, await aborted(run, inFlight));
  });

  it("rejects every query with the closed error when the page closes", async () => {
    document.body.innerHTML = "<select id=select><option>one</option></select>";
    const count = queries(createPage()).length;
    for (let index = 0; index < count; index++) {
      const page = createPage();
      const [apiName, run] = queries(page)[index];
      expectClosed(
        apiName,
        await closedDuring(page, () => run({ timeout: 0 }))
      );
    }
  });
});
