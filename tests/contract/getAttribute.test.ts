import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.getAttribute", () => {
  it("returns attributes, text, and values through matching Page and Locator methods", async () => {
    document.body.innerHTML = `
      <div id=text name=value>Text content</div>
    `;
    const page = createPage();

    expect(await page.locator("#text").getAttribute("name")).toBe("value");
  });

  it("honors a pre-aborted and an in-flight abort while querying", async () => {
    document.body.innerHTML = "";
    const page = createPage();

    const preAborted = new AbortController();
    preAborted.abort("pre-abort");
    const preAbortedError = await page
      .locator("#aborted")
      .getAttribute("name", { signal: preAborted.signal, timeout: 100 })
      .then(
        () => undefined,
        (error: Error) => error
      );
    expect(preAbortedError?.name).toBe("AbortError");
    expect(preAbortedError?.message).toBe("The operation was aborted");
    expect(preAbortedError?.cause).toBe("pre-abort");

    const controller = new AbortController();
    window.setTimeout(() => controller.abort("test abort"), 10);
    const inFlightError = await page
      .locator("#aborted")
      .getAttribute("name", { signal: controller.signal, timeout: 100 })
      .then(
        () => undefined,
        (error: Error) => error
      );
    expect(inFlightError?.name).toBe("AbortError");
    expect(inFlightError?.message).toBe(
      "test abort\nCall log:\n  - operation was aborted: test abort"
    );
    expect(inFlightError?.cause).toBe("test abort");
  });
});

describe("Page.getAttribute", () => {
  it("returns attributes, text, and values through matching Page and Locator methods", async () => {
    document.body.innerHTML = `
      <div id=text name=value>Text content</div>
    `;
    const page = createPage();

    expect(await page.getAttribute("#text", "missing")).toBeNull();
  });

  it("uses Page first-match semantics unless strict and Locator strictness always", async () => {
    document.body.innerHTML = "<div id=first></div><div id=second></div>";
    const page = createPage();

    await expect(page.getAttribute("div", "id")).resolves.toBe("first");
    await expect(
      page.getAttribute("div", "id", { strict: true })
    ).rejects.toThrow(/strict mode violation/);
    await expect(page.locator("div").getAttribute("id")).rejects.toThrow(
      /strict mode violation/
    );
  });
});
