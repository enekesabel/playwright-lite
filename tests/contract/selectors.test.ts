import { describe, expect, it } from "vitest";

import { createPage, expect as pageExpect, selectors } from "../../src/index";

// The registry is shared by every page of the document, as Playwright's is
// shared by every context, so each test registers names of its own.
const tagEngineSource = `({
  query(root, selector) { return root.querySelector(selector); },
  queryAll(root, selector) { return Array.from(root.querySelectorAll(selector)); },
})`;

describe("Selectors.register", () => {
  it("resolves locators, $, $$ and expect through the engine", async () => {
    document.body.innerHTML =
      "<div><span>A</span></div><div><span>B</span></div>";
    await selectors.register("tag", tagEngineSource);
    const page = createPage();

    expect(await page.$eval("tag=span", (e) => e.textContent)).toBe("A");
    expect(await page.$$("tag=div")).toHaveLength(2);
    expect(await page.locator("css=div >> tag=span").allTextContents()).toEqual(
      ["A", "B"]
    );
    expect(await page.locator("tag=div").getByText("B").count()).toBe(1);
    await pageExpect(page.locator("tag=span")).toHaveCount(2);
  });

  it("evaluates a function, a source string and { content } like Playwright", async () => {
    document.body.innerHTML = "<p>function</p>";
    const page = createPage();
    await selectors.register("fromFunction", () => ({
      query: (root: Element, selector: string) => root.querySelector(selector),
      queryAll: (root: Element, selector: string) =>
        Array.from(root.querySelectorAll(selector)),
    }));
    await selectors.register("fromString", tagEngineSource);
    await selectors.register("fromContent", { content: tagEngineSource });

    for (const name of ["fromFunction", "fromString", "fromContent"])
      expect(await page.locator(`${name}=p`).textContent()).toBe("function");
  });

  it("reaches pages that resolved selectors before the registration", async () => {
    document.body.innerHTML = "<section>late</section>";
    const page = createPage();
    const locator = page.locator("lateTag=section");
    expect(await page.locator("section").count()).toBe(1);

    await selectors.register("lateTag", tagEngineSource);

    expect(await locator.textContent()).toBe("late");
    expect(await createPage().locator("lateTag=section").count()).toBe(1);
  });

  it("runs a contentScript engine in the page's own JavaScript world", async () => {
    document.body.innerHTML = "<span>answer</span>";
    (window as unknown as { __answer?: Element }).__answer =
      document.querySelector("span")!;
    const answerEngine = `({
      query() { return window.__answer; },
      queryAll() { return window.__answer ? [window.__answer] : []; },
    })`;
    await selectors.register("isolatedAnswer", answerEngine, {
      contentScript: true,
    });

    expect(
      await createPage().locator("isolatedAnswer=ignored").textContent()
    ).toBe("answer");
  });

  it("keeps engine names case-sensitive", async () => {
    document.body.innerHTML = "<div></div>";
    await selectors.register("dummy", tagEngineSource);
    await selectors.register("duMMy", tagEngineSource);

    const error = await createPage()
      .$("tAG=div")
      .catch((error: Error) => error);
    expect((error as Error).message).toContain(
      'Unknown engine "tAG" while parsing selector tAG=div'
    );
  });

  it("rejects invalid, predefined and duplicate names with Playwright's errors", async () => {
    await expect(selectors.register("$", tagEngineSource)).rejects.toThrow(
      "selectors.register: Selector engine name may only contain [a-zA-Z0-9_] characters"
    );
    await expect(selectors.register("css", tagEngineSource)).rejects.toThrow(
      'selectors.register: "css" is a predefined selector engine'
    );
    await expect(selectors.register("zs", tagEngineSource)).rejects.toThrow(
      'selectors.register: "zs" is a predefined selector engine'
    );
    await selectors.register("registeredOnce", tagEngineSource);
    await expect(
      selectors.register("registeredOnce", tagEngineSource)
    ).rejects.toThrow(
      'selectors.register: "registeredOnce" selector engine has been already registered'
    );
    await expect(
      selectors.register(42 as unknown as string, tagEngineSource)
    ).rejects.toThrow(
      "selectors.register: selectorEngine.name: expected string, got number"
    );
  });

  it("rejects scripts and options the pinned client and protocol reject", async () => {
    await expect(selectors.register("noContent", {})).rejects.toThrow(
      "Either path or content property must be present"
    );
    await expect(
      selectors.register("badContent", { content: 1 as unknown as string })
    ).rejects.toThrow(
      "selectors.register: selectorEngine.source: expected string, got number"
    );
    await expect(
      selectors.register("badOption", tagEngineSource, {
        contentScript: "yes" as unknown as boolean,
      })
    ).rejects.toThrow(
      "selectors.register: selectorEngine.contentScript: expected boolean, got string"
    );
  });

  it("rejects a path, which the document cannot read", async () => {
    await expect(
      selectors.register("fromPath", { path: "engine.js" })
    ).rejects.toThrow(
      "selectors.register: the `path` property is not supported; pass `content`."
    );
    await selectors.register("pathAndContent", {
      path: "engine.js",
      content: tagEngineSource,
    });
  });

  // Last: as in Playwright, a source that throws breaks every later selector.
  it("registers a source that throws, which then fails the page's next selector", async () => {
    document.body.innerHTML = "<div></div>";
    const page = createPage();
    expect(await page.locator("div").count()).toBe(1);

    await selectors.register(
      "broken",
      "(() => { throw new Error('boom'); })()"
    );

    await expect(page.locator("div").count()).rejects.toThrow("boom");
  });
});
