import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

declare global {
  interface Window {
    __injected?: unknown;
  }
}

function scriptUrl(source: string) {
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

describe("Page.addScriptTag", () => {
  let existing: Set<Element>;

  beforeEach(() => {
    existing = new Set(document.head.children);
  });

  afterEach(() => {
    for (const child of Array.from(document.head.children))
      if (!existing.has(child)) child.remove();
    delete window.__injected;
  });

  it("rejects a call without url, path or content", async () => {
    const page = createPage();
    for (const options of [undefined, {}, "/injectedfile.js"])
      await expect(page.addScriptTag(options as never)).rejects.toThrow(
        "Provide an object with a `url`, `path` or `content` property"
      );
  });

  it("injects content and returns a handle for the script element", async () => {
    const page = createPage();
    const handle = await page.addScriptTag({
      content: 'window["__injected"] = 35;',
    });
    expect(handle.asElement()).toBe(handle);
    expect(window.__injected).toBe(35);
    const script = document.head.lastElementChild as HTMLScriptElement;
    expect(script.tagName).toBe("SCRIPT");
    expect(script.type).toBe("text/javascript");
    expect(await handle.evaluate((node) => node.textContent)).toBe(
      'window["__injected"] = 35;'
    );
  });

  it("injects content with the requested type", async () => {
    const page = createPage();
    await page.addScriptTag({
      content: 'window["__injected"] = 42;',
      type: "module",
    });
    const script = document.head.lastElementChild as HTMLScriptElement;
    expect(script.type).toBe("module");
    await page.waitForFunction(() => window.__injected === 42);
  });

  it("resolves a url only after the script has loaded", async () => {
    const page = createPage();
    const url = scriptUrl('window["__injected"] = 7;');
    const handle = await page.addScriptTag({ url, type: "text/javascript" });
    expect(window.__injected).toBe(7);
    const script = document.head.lastElementChild as HTMLScriptElement;
    expect(script.src).toBe(url);
    expect(script.type).toBe("text/javascript");
    expect(handle.asElement()).toBe(handle);
    URL.revokeObjectURL(url);
  });

  it("rejects with the script source when the url fails to load", async () => {
    const page = createPage();
    const url = scriptUrl("window.__injected = 1;");
    URL.revokeObjectURL(url);
    await expect(page.addScriptTag({ url })).rejects.toThrow(
      `Failed to load script at ${url}`
    );
    expect(window.__injected).toBeUndefined();
  });

  it("rejects the path option, which needs the filesystem", async () => {
    const page = createPage();
    await expect(
      page.addScriptTag({ path: "tests/assets/injectedfile.js" })
    ).rejects.toThrow(
      "addScriptTag: the `path` option is not supported; pass `url` or `content`."
    );
  });
});
