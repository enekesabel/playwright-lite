import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";

afterEach(async () => {
  await createPage().hideHighlight();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Locator.hideHighlight", () => {
  it("removes only its own overlay, leaving others", async () => {
    const roots: ShadowRoot[] = [];
    const attachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
      this: Element,
      options: ShadowRootInit
    ) {
      const root = attachShadow.call(this, options);
      if (this.localName === "x-pw-glass") roots.push(root);
      return root;
    });
    const highlights = () =>
      roots.flatMap((root) =>
        Array.from(root.querySelectorAll<HTMLElement>("x-pw-highlight")).filter(
          (element) => element.isConnected
        )
      );
    document.body.innerHTML =
      '<button id="first">One</button><button id="second">Two</button>';
    const page = createPage();
    const first = page.locator("#first");
    const second = page.locator("#second");
    await first.highlight();
    await second.highlight();
    await expect.poll(() => highlights().length).toBe(2);

    await second.hideHighlight();

    await expect.poll(() => highlights().length).toBe(1);
  });
});

describe("Page.hideHighlight", () => {
  it("removes every overlay on the page", async () => {
    const roots: ShadowRoot[] = [];
    const attachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
      this: Element,
      options: ShadowRootInit
    ) {
      const root = attachShadow.call(this, options);
      if (this.localName === "x-pw-glass") roots.push(root);
      return root;
    });
    const highlights = () =>
      roots.flatMap((root) =>
        Array.from(root.querySelectorAll<HTMLElement>("x-pw-highlight")).filter(
          (element) => element.isConnected
        )
      );
    document.body.innerHTML =
      '<button id="first">One</button><button id="second">Two</button>';
    const page = createPage();

    await page.locator("#first").highlight();
    await page.locator("#second").highlight();
    await expect.poll(() => highlights().length).toBe(2);

    await page.hideHighlight();

    await expect.poll(() => highlights().length).toBe(0);
  });
});
