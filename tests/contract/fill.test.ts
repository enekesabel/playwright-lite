/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.fill", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fills text in one input event", async () => {
    document.body.innerHTML = '<input id="input" />';
    const page = createPage();
    const input = document.querySelector("#input") as HTMLInputElement;
    const values: string[] = [];
    input.addEventListener("input", () => values.push(input.value));

    await page.fill("#input", "ab");

    expect(values).toEqual(["ab"]);
  });

  it("fills text inputs, textareas, and contenteditables through InjectedScript", async () => {
    document.body.innerHTML = `
      <input id="input" type="text" value="old" />
      <textarea id="textarea">old</textarea>
      <div id="editable" contenteditable>old</div>
    `;
    const page = createPage();
    const inputEvents: string[] = [];
    for (const element of document.querySelectorAll("input, textarea, div"))
      element.addEventListener("input", () => inputEvents.push(element.id));

    await page.locator("#input").fill("new input");
    await page.locator("#textarea").fill("new textarea");
    await page.locator("#editable").fill("new editable");

    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "new input"
    );
    expect(
      (document.querySelector("#textarea") as HTMLTextAreaElement).value
    ).toBe("new textarea");
    expect(document.querySelector("#editable")!.textContent).toBe(
      "new editable"
    );
    expect(inputEvents).toEqual(["input", "textarea", "editable"]);
  });

  it("fills number inputs through the pinned needsinput path", async () => {
    document.body.innerHTML = '<input id="number" type="number" value="123" />';
    const page = createPage();
    const number = document.querySelector("#number") as HTMLInputElement;
    const events: string[] = [];
    for (const type of ["input", "change"])
      number.addEventListener(type, () => events.push(type));

    await page.fill("#number", "42");
    expect(number.value).toBe("42");
    await page.fill("#number", "-10e5");
    expect(number.value).toBe("-10e5");
    await page.fill("#number", "");

    expect(number.value).toBe("");
    expect(events).toEqual(["input", "input", "input"]);
  });

  it("fills, replaces, and clears email inputs without using selection APIs", async () => {
    document.body.innerHTML =
      '<input id="email" type="email" value="before@example.test" />';
    const page = createPage();
    const email = document.querySelector("#email") as HTMLInputElement;
    const events: string[] = [];
    email.addEventListener("input", () => events.push(email.value));

    await page.fill("#email", "first@example.test");
    await page.locator("#email").fill("second@example.test");
    await page.fill("#email", "");

    expect(email.value).toBe("");
    expect(events).toEqual(["first@example.test", "second@example.test", ""]);
  });

  it("uses InjectedScript input-type validation and editability checks for fill", async () => {
    document.body.innerHTML = `
      <input id="checkbox" type="checkbox" />
      <input id="disabled" disabled />
      <input id="readonly" readonly value="before" />
    `;
    const page = createPage();

    await expect(page.locator("#checkbox").fill("x")).rejects.toThrow(
      /cannot be filled/
    );
    await expect(page.locator("#disabled").fill("x")).rejects.toThrow(
      /not enabled/
    );
    await expect(page.locator("#readonly").fill("x")).rejects.toThrow(
      /not editable/
    );
    expect(
      (document.querySelector("#readonly") as HTMLInputElement).value
    ).toBe("before");
  });

  it.each([
    ["wrapping", '<label>Caption<input value="old"></label>'],
    [
      "linked",
      '<label for="control">Caption</label><input id="control" value="old">',
    ],
  ])("fills a %s label's control", async (_kind, markup) => {
    document.body.innerHTML = markup;
    const page = createPage();
    const label = page.locator("label");

    await label.fill("new value");
    expect(document.querySelector("input")?.value).toBe("new value");
    expect(document.querySelector("label")?.textContent).toBe("Caption");

    await label.fill("");
    expect(document.querySelector("input")?.value).toBe("");
    expect(document.querySelector("label")?.textContent).toBe("Caption");
  });

  // page-fill.spec.ts's "should throw nice error without injected script stack
  // when element is not an <input>" covers the Page form upstream.
  it("reports an injected rejection under its own member name", async () => {
    document.body.innerHTML = `<select><option>value1</option></select>`;
    const page = createPage();

    await expect(page.locator("select").fill("")).rejects.toThrow(
      "locator.fill: Error: Element is not an <input>, <textarea> or [contenteditable] element\nCall log:"
    );
  });

  // page-fill.spec.ts's "should throw if passed a non-string value" covers this
  // upstream, but its setup navigates away from the fixture document.
  it("rejects a non-string value like the pinned protocol validation", async () => {
    document.body.innerHTML = '<input id="input" value="before" />';
    const page = createPage();

    await expect(page.locator("#input").fill(123 as any)).rejects.toThrow(
      "value: expected string, got number"
    );
    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "before"
    );
  });

  it("retries disabled actions until the state becomes actionable", async () => {
    document.body.innerHTML = `
      <input id="input" disabled />
    `;
    const page = createPage();

    window.setTimeout(() => {
      (document.querySelector("#input") as HTMLInputElement).disabled = false;
    }, 25);

    await page.locator("#input").fill("ready");

    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "ready"
    );
  });
});

describe("Page.fill", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("delegates the browser-feasible action without recursive dispatch", async () => {
    document.body.innerHTML = `<input id=input />`;
    const page = createPage();

    await page.fill("#input", "a");

    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "a"
    );
  });
});
