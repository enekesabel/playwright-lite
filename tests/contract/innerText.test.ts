import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { ADAPTER_TIMEOUT_ERROR } from "../../src/errors";

describe("Locator.innerText", () => {
  it("returns strict inner text and HTML plus all matching text values", async () => {
    document.body.innerHTML = `
      <div class=item><span>One</span></div>
      <div class=item><span>Two</span></div>
      <svg id=svg><text>Vector</text></svg>
    `;
    const page = createPage();

    expect(await page.locator(".item").last().innerText()).toBe("Two");
    await expect(page.locator(".item").innerText()).rejects.toThrow(
      /strict mode violation/
    );
    await expect(page.locator("#svg").innerText()).rejects.toThrow(
      "Node is not an HTMLElement"
    );
  });

  it("marks locator query timeouts and includes the locator call log", async () => {
    document.body.innerHTML = "";
    const page = createPage();
    const error = await page
      .locator("span")
      .innerText({ timeout: 1 })
      .catch((error) => error);

    expect(error.name).toBe("TimeoutError");
    expect(error[ADAPTER_TIMEOUT_ERROR]).toBe(true);
    expect(error.message).toContain("Timeout 1ms exceeded.");
    expect(error.message).toContain("waiting for locator('span')");
  });
});

describe("Page.innerText", () => {
  it("delegates title and selector queries to the controlled document", async () => {
    document.body.innerHTML = `
      <p id=copy>Hello <strong>world</strong></p>
    `;
    const page = createPage();

    await expect(page.innerText("#copy")).resolves.toBe("Hello world");
  });
});
