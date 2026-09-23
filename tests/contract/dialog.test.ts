import { describe, expect, it } from "vitest";

import { listenedPages } from "./pageEvents";

describe("Dialog", () => {
  const dialogPage = listenedPages();

  it("returns dialog.accept(value) to the document's prompt() call", () => {
    const page = dialogPage();
    page.on("dialog", (dialog) => {
      void dialog.accept("answer!");
    });

    expect(window.prompt("question?", "yes.")).toBe("answer!");
  });

  it("rejects a non-string accept value", async () => {
    const page = dialogPage();
    const settled = new Promise<unknown>((resolve) => {
      page.on("dialog", (dialog) =>
        resolve(dialog.accept(123 as unknown as string))
      );
    });
    window.prompt("question?");

    await expect(settled).rejects.toThrow(
      "dialog.accept: promptText: expected string, got number"
    );
  });
});
