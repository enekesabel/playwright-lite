import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

describe("Locator.normalize", () => {
  it("returns a locator for the selector the first match regenerates to", async () => {
    document.body.innerHTML = `
      <button class="primary">Submit</button>
      <button class="primary">Cancel</button>
      <div class="card" data-testid="profile-card">Profile</div>
      <span class="greeting">hello world</span>
      <input id="name" placeholder="Your name">
    `;
    const page = createPage();

    const normalized = async (selector: string) =>
      (await page.locator(selector).normalize()).toString();

    // Not strict: the first of several matches is the one regenerated.
    expect(await normalized("button.primary")).toBe(
      "getByRole('button', { name: 'Submit' })"
    );
    expect(await normalized("button >> nth=1")).toBe(
      "getByRole('button', { name: 'Cancel' })"
    );
    expect(await normalized("div.card")).toBe("getByTestId('profile-card')");
    expect(await normalized("span.greeting")).toBe("getByText('hello world')");
    expect(await normalized("#name")).toBe(
      "getByRole('textbox', { name: 'Your name' })"
    );

    const resolved = await page.locator("button >> nth=1").normalize();
    expect(await resolved.textContent()).toBe("Cancel");
  });

  it("drops the locator's description", async () => {
    document.body.innerHTML = `<button>Submit</button>`;
    const page = createPage();

    const resolved = await page
      .locator("button")
      .describe("the button")
      .normalize();

    expect(resolved.description()).toBeNull();
    expect(resolved.toString()).toBe("getByRole('button', { name: 'Submit' })");
  });

  it("generates test ids with the page's test id attribute", async () => {
    document.body.innerHTML = `<div class="card" data-test="custom">Custom</div>`;
    const page = createPage({ testIdAttribute: "data-test" });

    const resolved = await page.locator("div.card").normalize();

    expect(resolved.toString()).toBe("getByTestId('custom')");
  });

  it("rejects at once when nothing matches, without waiting", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    // An element added shortly after the call does not satisfy it.
    const timer = window.setTimeout(() => {
      document.body.innerHTML = `<div id="missing">late</div>`;
    }, 50);

    await expect(page.locator("#missing").normalize()).rejects.toThrow(
      "locator.normalize: No element matching #missing"
    );
    window.clearTimeout(timer);
  });

  it("names itself in a selector parse error", async () => {
    const page = createPage();

    await expect(page.locator("[[[").normalize()).rejects.toThrow(
      /^locator\.normalize: Unexpected token "" while parsing css selector "\[\[\["/
    );
  });
});
