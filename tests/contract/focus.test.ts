import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.focus", () => {
  it("focuses the target element and fires a focus event", async () => {
    document.body.innerHTML = `<input id=input value=before />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("focus", () => events.push("focus"));

    await page.locator("#input").focus();

    expect(document.activeElement).toBe(input);
    expect(events).toEqual(["focus"]);
  });

  it("rejects focus on a locator matching more than one element", async () => {
    document.body.innerHTML = `
      <button>First</button><button>Second</button>
    `;
    const page = createPage();

    await expect(page.locator("button").focus()).rejects.toThrow(
      "strict mode violation"
    );
  });
});

describe("Page.focus", () => {
  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();

    await page.focus("#input");

    expect(document.activeElement).toBe(document.querySelector("#input"));
  });

  it("reports a real focus failure that races an abort", async () => {
    document.body.innerHTML =
      '<div id="a" tabindex="0"></div><div id="b" tabindex="0"></div>';
    const page = createPage();
    const controller = new AbortController();
    const resolveAll = document.querySelectorAll.bind(document);
    // Abort while the element is being resolved, so the strict violation and
    // the aborted signal reach the focus path in the same turn.
    document.querySelectorAll = ((selector: string) => {
      controller.abort(new Error("stop"));
      return resolveAll(selector);
    }) as typeof document.querySelectorAll;

    try {
      const error = await page
        .focus("div", { signal: controller.signal, strict: true, timeout: 0 })
        .then(
          () => undefined,
          (error: Error) => error
        );

      expect(controller.signal.aborted).toBe(true);
      expect(error?.name).not.toBe("AbortError");
      expect(error?.message).toMatch(/strict mode violation/);
    } finally {
      delete (document as Partial<Document>).querySelectorAll;
    }
  });
});
