import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

function styleUrl(source: string) {
  return URL.createObjectURL(new Blob([source], { type: "text/css" }));
}

function backgroundColor() {
  return getComputedStyle(document.body).getPropertyValue("background-color");
}

describe("Page.addStyleTag", () => {
  let existing: Set<Element>;

  beforeEach(() => {
    existing = new Set(document.head.children);
  });

  afterEach(() => {
    for (const child of Array.from(document.head.children))
      if (!existing.has(child)) child.remove();
  });

  it("rejects a call without url, path or content", async () => {
    const page = createPage();
    for (const options of [undefined, {}, "/injectedstyle.css"])
      await expect(page.addStyleTag(options as never)).rejects.toThrow(
        "Provide an object with a `url`, `path` or `content` property"
      );
  });

  it("injects content and returns a handle for the style element", async () => {
    const page = createPage();
    const handle = await page.addStyleTag({
      content: "body { background-color: green; }",
    });
    expect(handle.asElement()).toBe(handle);
    expect(backgroundColor()).toBe("rgb(0, 128, 0)");
    const style = document.head.lastElementChild as HTMLStyleElement;
    expect(style.tagName).toBe("STYLE");
    expect(style.type).toBe("text/css");
  });

  it("resolves a url only after the stylesheet has loaded", async () => {
    const page = createPage();
    const url = styleUrl("body { background-color: rgb(255, 0, 0); }");
    const handle = await page.addStyleTag({ url });
    expect(backgroundColor()).toBe("rgb(255, 0, 0)");
    const link = document.head.lastElementChild as HTMLLinkElement;
    expect(link.tagName).toBe("LINK");
    expect(link.rel).toBe("stylesheet");
    expect(link.href).toBe(url);
    expect(handle.asElement()).toBe(handle);
    URL.revokeObjectURL(url);
  });

  it("rejects with the stylesheet source when the url fails to load", async () => {
    const page = createPage();
    const url = styleUrl("body { background-color: rgb(0, 0, 255); }");
    URL.revokeObjectURL(url);
    await expect(page.addStyleTag({ url })).rejects.toThrow(
      `Failed to load style at ${url}`
    );
  });

  it("rejects the path option, which needs the filesystem", async () => {
    const page = createPage();
    await expect(
      page.addStyleTag({ path: "tests/assets/injectedstyle.css" })
    ).rejects.toThrow(
      "addStyleTag: the `path` option is not supported; pass `url` or `content`."
    );
  });
});
