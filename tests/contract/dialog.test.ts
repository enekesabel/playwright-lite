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

  it("reports one call to each subscribed page, which settle it once between them", async () => {
    const first = dialogPage();
    const second = dialogPage();
    const seen: string[] = [];
    let late: Promise<void> | undefined;
    first.on("dialog", (dialog) => {
      seen.push(`first:${dialog.message()}`);
      expect(dialog.page()).toBe(first);
      void dialog.accept("from first");
    });
    second.on("dialog", (dialog) => {
      seen.push(`second:${dialog.message()}`);
      expect(dialog.page()).toBe(second);
      late = dialog.accept("from second");
    });

    expect(window.prompt("question?")).toBe("from first");
    expect(seen).toEqual(["first:question?", "second:question?"]);
    await expect(late).rejects.toThrow(
      "dialog.accept: Cannot accept dialog which is already handled!"
    );
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
