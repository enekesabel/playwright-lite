/* eslint-disable @typescript-eslint/no-explicit-any -- intentional casts to test runtime validation */
import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.selectOption", () => {
  it("selects options through InjectedScript and dispatches input and change", async () => {
    document.body.innerHTML = `
      <select id=select multiple>
        <option value=one>One</option>
        <option value=two>Two</option>
        <option value=three>Three</option>
      </select>
    `;
    const page = createPage();
    const select = document.querySelector("#select") as HTMLSelectElement;
    const events: string[] = [];
    select.addEventListener("input", () => events.push("input"));
    select.addEventListener("change", () => events.push("change"));

    await expect(
      page
        .locator("#select")
        .selectOption([{ value: "one" }, { label: "Three" }])
    ).resolves.toEqual(["one", "three"]);
    expect(
      Array.from(select.selectedOptions, (option) => option.value)
    ).toEqual(["one", "three"]);
    expect(events).toEqual(["input", "change"]);
    await expect(
      page.locator("#select").selectOption("missing", { timeout: 20 })
    ).rejects.toThrow(/Timeout 20ms exceeded.*Options not found/);

    await expect(page.locator("#select").selectOption(null)).resolves.toEqual(
      []
    );
    expect(select.selectedOptions).toHaveLength(0);
  });

  it("retries selectOption until matching options are inserted", async () => {
    document.body.innerHTML = `<select id=select></select>`;
    const page = createPage();
    const select = document.querySelector("#select") as HTMLSelectElement;
    window.setTimeout(() => {
      const option = document.createElement("option");
      option.value = "later";
      select.append(option);
    }, 15);

    await expect(
      page.locator("#select").selectOption("later", { timeout: 200 })
    ).resolves.toEqual(["later"]);
  });

  it("retries selectOption after a disabled matching option becomes enabled", async () => {
    document.body.innerHTML = `
      <select id=select><option value=later disabled>Later</option></select>
    `;
    const page = createPage();
    const option = document.querySelector("option") as HTMLOptionElement;
    const injected = (page as any).actionableInjected;
    const selectOptions = injected.selectOptions.bind(injected);
    let attempts = 0;
    const selectOptionsSpy = vi
      .spyOn(injected, "selectOptions")
      .mockImplementation((...args: any[]) => {
        attempts++;
        const result = selectOptions(...args);
        if (attempts === 1) option.disabled = false;
        return result;
      });

    try {
      await expect(
        page.locator("#select").selectOption("later", { timeout: 200 })
      ).resolves.toEqual(["later"]);
      expect(attempts).toBeGreaterThanOrEqual(2);
    } finally {
      selectOptionsSpy.mockRestore();
    }
  });

  it("re-resolves a select after its target detaches", async () => {
    document.body.innerHTML = `
      <select id=select><option value=one>One</option></select>
    `;
    const page = createPage();
    const select = document.querySelector("#select") as HTMLSelectElement;
    const injected = (page as any).actionableInjected;
    const selectOptions = injected.selectOptions.bind(injected);
    let attempts = 0;
    const selectOptionsSpy = vi
      .spyOn(injected, "selectOptions")
      .mockImplementation((...args: any[]) => {
        attempts++;
        if (attempts === 1) {
          const replacement = document.createElement("select");
          replacement.id = "select";
          replacement.innerHTML = `<option value=one>One</option>`;
          select.replaceWith(replacement);
          return "error:notconnected";
        }
        return selectOptions(...args);
      });

    try {
      await expect(
        page.locator("#select").selectOption("one", { timeout: 200 })
      ).resolves.toEqual(["one"]);
      expect(attempts).toBeGreaterThanOrEqual(2);
    } finally {
      selectOptionsSpy.mockRestore();
    }
  });

  it("times out missing select options after the configured wait", async () => {
    document.body.innerHTML = `<select id=select></select>`;
    const page = createPage();
    const startedAt = Date.now();
    await expect(
      page.locator("#select").selectOption("missing", { timeout: 20 })
    ).rejects.toThrow(/Timeout 20ms exceeded/);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
  });
});

describe("Page.selectOption", () => {
  it("resolves with the selected option values", async () => {
    document.body.innerHTML = `<select id=select><option value=one>One</option></select>`;
    const page = createPage();

    await expect(page.selectOption("#select", "one")).resolves.toEqual(["one"]);
  });
});
