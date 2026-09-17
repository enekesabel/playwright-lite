import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.getByRole", () => {
  it("Locator.getByRole supports full options including pressed", async () => {
    document.body.innerHTML = `
      <div>
        <button aria-pressed="true">Bold</button>
        <button>Italic</button>
      </div>
    `;
    const page = createPage();
    const pressed = page.locator("div").getByRole("button", { pressed: true });
    expect(await pressed.count()).toBe(1);
  });
});

describe("Page.getByRole", () => {
  it("supports name option", async () => {
    document.body.innerHTML = `
      <button>Save</button>
      <button>Cancel</button>
    `;
    const page = createPage();
    const save = page.getByRole("button", { name: "Save" });
    expect(await save.count()).toBe(1);
  });

  it("supports checked option", async () => {
    document.body.innerHTML = `
      <input type="checkbox" checked aria-label="agree" />
      <input type="checkbox" aria-label="other" />
    `;
    const page = createPage();
    const checked = page.getByRole("checkbox", { checked: true });
    expect(await checked.count()).toBe(1);
  });

  it("supports description option via aria-describedby", async () => {
    document.body.innerHTML = `
      <button aria-describedby="desc1">OK</button>
      <span id="desc1">Confirms the action</span>
      <button>Cancel</button>
    `;
    const page = createPage();
    const btn = page.getByRole("button", {
      description: "Confirms the action",
    });
    expect(await btn.count()).toBe(1);
  });
});
