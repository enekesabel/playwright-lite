import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { assetUrl, contractUrl, restoreFetch } from "./network";

describe("Response", () => {
  restoreFetch();

  it("headersArray() and headerValues() see a repeated header as one value", async () => {
    const page = createPage();
    const waiting = page.waitForResponse("**/__repeated-header", {
      timeout: 5_000,
    });
    void window.fetch(contractUrl("/__repeated-header"));
    const response = await waiting;

    const repeated = (await response.headersArray()).filter(
      ({ name }) => name === "x-repeated"
    );
    // Playwright reports two entries and ["one", "two"]; the document sees
    // only the value the browser joined.
    expect(repeated).toEqual([{ name: "x-repeated", value: "one, two" }]);
    expect(await response.headerValues("X-Repeated")).toEqual(["one, two"]);
    expect(await response.headerValues("absent")).toEqual([]);
  });

  it("headersArray() returns a new array on every call", async () => {
    const page = createPage();
    const waiting = page.waitForResponse("**/title.html*", { timeout: 5_000 });
    void window.fetch(assetUrl("?headers-array-copy"));
    const response = await waiting;

    const first = await response.headersArray();
    first.length = 0;
    expect((await response.headersArray()).length).toBeGreaterThan(0);
  });

  it("headerValue() and headerValues() read no header from the headers object's prototype", async () => {
    const page = createPage();
    const waiting = page.waitForResponse("**/title.html*", { timeout: 5_000 });
    void window.fetch(assetUrl("?prototype-names"));
    const response = await waiting;

    expect(await response.headerValue("constructor")).toBe(null);
    expect(await response.headerValue("__proto__")).toBe(null);
    expect(await response.headerValues("constructor")).toEqual([]);
    expect(await response.headerValues("__proto__")).toEqual([]);
  });
});
