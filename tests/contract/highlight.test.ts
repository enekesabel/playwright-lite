import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";

afterEach(async () => {
  await createPage().hideHighlight();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Locator.highlight", () => {
  it("renders styled highlights within a closed shadow root and disposes only its own overlay", async () => {
    // Observe the real closed shadow root without changing its mode or the
    // production InjectedScript. These are DOM assertions, not delegate spies.
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
    const disposable = await first.highlight({
      style: "background-color: red",
    });
    await second.highlight({
      style: { backgroundColor: "lime", zIndex: 3, "--accent": "blue" },
    });
    await expect.poll(() => highlights().length).toBe(2);
    for (const root of roots) expect(root.mode).toBe("closed");
    for (const element of highlights())
      expect(element.getBoundingClientRect().width).toBeGreaterThan(0);
    const colors = highlights().map(
      (element) => getComputedStyle(element).backgroundColor
    );
    expect(colors).toEqual(["rgb(255, 0, 0)", "rgb(0, 255, 0)"]);
    expect(highlights()[1].style.zIndex).toBe("3");
    expect(highlights()[1].style.getPropertyValue("--accent").trim()).toBe(
      "blue"
    );

    await disposable.dispose();
    await disposable[Symbol.asyncDispose]();
    await expect.poll(() => highlights().length).toBe(1);
    const remainingColor = getComputedStyle(highlights()[0]).backgroundColor;
    expect(remainingColor).toBe("rgb(0, 255, 0)");
  });

  it("is a no-op for a missing target and rejects an invalid selector", async () => {
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
    const page = createPage();

    await page.locator(".missing").highlight();
    expect(highlights()).toHaveLength(0);
    await expect(page.locator("[").highlight()).rejects.toThrow();
  });
});
