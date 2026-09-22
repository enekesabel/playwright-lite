import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

/**
 * `window.alert`/`confirm`/`prompt` are wrapped by whichever page subscribes
 * first (`DialogObservation`), shared by every page of this window. Every
 * test's listeners are dropped afterwards so the wrapper never survives into
 * the next test.
 */
const pages: ReturnType<typeof createPage>[] = [];
afterEach(() => {
  for (const page of pages.splice(0)) page.removeAllListeners();
});
const dialogPage = () => {
  const page = createPage();
  pages.push(page);
  return page;
};

describe("Dialog", () => {
  it("returns dialog.accept(value) to the document's prompt() call", () => {
    const page = dialogPage();
    page.on("dialog", (dialog) => {
      void dialog.accept("answer!");
    });

    expect(window.prompt("question?", "yes.")).toBe("answer!");
  });

  it("dismisses a dialog no listener settles synchronously", () => {
    const page = dialogPage();
    const seen: string[] = [];
    page.on("dialog", (dialog) => {
      // Never calls accept()/dismiss(): the wrapped call must still resolve,
      // dismissed, once every listener has run.
      seen.push(dialog.type());
    });

    expect(window.confirm("boolean?")).toBe(false);
    expect(window.prompt("question?")).toBe(null);
    expect(seen).toEqual(["confirm", "prompt"]);
  });

  it("restores window.alert/confirm/prompt once the last dialog listener leaves", () => {
    const nativeAlert = window.alert;
    const nativeConfirm = window.confirm;
    const nativePrompt = window.prompt;
    const page = dialogPage();
    const listener = () => {};

    page.on("dialog", listener);
    expect(window.alert).not.toBe(nativeAlert);
    expect(window.confirm).not.toBe(nativeConfirm);
    expect(window.prompt).not.toBe(nativePrompt);

    page.off("dialog", listener);
    expect(window.alert).toBe(nativeAlert);
    expect(window.confirm).toBe(nativeConfirm);
    expect(window.prompt).toBe(nativePrompt);
  });
});
