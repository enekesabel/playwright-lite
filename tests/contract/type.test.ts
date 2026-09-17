import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

type StrictOptions = { strict?: boolean; timeout?: number };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.type", () => {
  it("does not type later characters after timeout", async () => {
    document.body.innerHTML = '<input id="input" />';
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;
    page.setDefaultTimeout(20);

    await expect(page.type("#input", "ab", { delay: 100 })).rejects.toThrow(
      "Timeout 20ms exceeded"
    );
    await page.waitForTimeout(120);

    expect(input.value).toBe("a");
  });

  it("types text through a strict locator with delay and an explicit zero timeout", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;

    await page.locator("#input").type("abc", { delay: 5, timeout: 0 });

    expect(input.value).toBe("abc");
  });
});

describe("Page.type", () => {
  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();

    await page.type("#input", "cd");

    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "cd"
    );
  });

  it("Page.type empty text focuses the first match without keyboard input", async () => {
    document.body.innerHTML =
      '<input class="target" value="first"><input class="target" value="second">';
    const inputs = [...document.querySelectorAll<HTMLInputElement>(".target")];
    const events: string[] = [];
    for (const input of inputs)
      for (const name of ["keydown", "input"])
        input.addEventListener(name, () => events.push(name));

    await createPage().type(".target", "");
    expect(document.activeElement).toBe(inputs[0]);
    expect(inputs.map((input) => input.value)).toEqual(["first", "second"]);
    expect(events).toEqual([]);
  });

  it("Page.type empty text waits for a matching selector", async () => {
    await expect(
      createPage().type(".target", "", { timeout: 50 })
    ).rejects.toThrow("Timeout 50ms exceeded");
  });
});

describe.each(["Page", "Locator"] as const)("%s.type empty text", (owner) => {
  const type = (
    page: Page,
    text: string,
    options?: StrictOptions
  ): Promise<void> =>
    owner === "Page"
      ? page.type(".target", text, options)
      : page.locator(".target").type(text);

  it("enforces strictness before focus or input", async () => {
    document.body.innerHTML =
      '<input class="target" value="first"><input class="target" value="second">';
    const inputs = [...document.querySelectorAll<HTMLInputElement>(".target")];
    const events: string[] = [];
    for (const input of inputs)
      for (const name of ["focus", "keydown", "input"])
        input.addEventListener(name, () => events.push(name));

    await expect(
      type(createPage(), "", owner === "Page" ? { strict: true } : undefined)
    ).rejects.toThrow("strict mode violation");
    expect(document.activeElement).toBe(document.body);
    expect(inputs.map((input) => input.value)).toEqual(["first", "second"]);
    expect(events).toEqual([]);
  });

  it("resolves and focuses once before typing", async () => {
    document.body.innerHTML = '<input class="target"><input id="other">';
    const target = document.querySelector<HTMLInputElement>(".target")!;
    const other = document.querySelector<HTMLInputElement>("#other")!;
    target.addEventListener("input", () => other.focus(), { once: true });

    await type(createPage(), "ab");
    expect(target.value).toBe("a");
    expect(other.value).toBe("b");
    expect(document.activeElement).toBe(other);
  });

  it("does not retarget a replacement after typing starts", async () => {
    document.body.innerHTML = '<input class="target">';
    const target = document.querySelector<HTMLInputElement>(".target")!;
    let replacement: HTMLInputElement | undefined;
    target.addEventListener(
      "input",
      () => {
        target.remove();
        replacement = document.createElement("input");
        replacement.className = "target";
        document.body.append(replacement);
      },
      { once: true }
    );

    await type(createPage(), "ab");
    expect(target.value).toBe("a");
    expect(replacement?.value).toBe("");
  });
});
