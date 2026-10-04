import { describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { assetUrl, restoreFetch, sendXhr } from "./network";

describe("Request", () => {
  restoreFetch();

  it("allHeaders() reports the headers the fetch call set, like headers()", async () => {
    const page = createPage();
    const waiting = page.waitForRequest("**/title.html*", { timeout: 5_000 });
    void window.fetch(assetUrl("?all-headers"), {
      headers: { "X-Contract": "yes" },
    });
    const request = await waiting;

    const headers = await request.allHeaders();
    expect(headers).toEqual(request.headers());
    expect(headers["x-contract"]).toBe("yes");
    // The browser adds these on the wire, where the document cannot read them.
    expect(headers).not.toHaveProperty("user-agent");
  });

  it("headersArray() reports a repeated fetch header once, joined by the browser", async () => {
    const page = createPage();
    const waiting = page.waitForRequest("**/title.html*", { timeout: 5_000 });
    // Pinned page-network-request.spec.ts "should report raw headers".
    void window.fetch(assetUrl("?headers-array"), {
      headers: [
        ["header-a", "value-a"],
        ["header-b", "value-b"],
        ["header-a", "value-a-1"],
        ["header-a", "value-a-2"],
      ],
    });
    const request = await waiting;

    expect(await request.headersArray()).toEqual([
      { name: "header-a", value: "value-a, value-a-1, value-a-2" },
      { name: "header-b", value: "value-b" },
    ]);
    expect(await request.headerValue("header-a")).toBe(
      "value-a, value-a-1, value-a-2"
    );
  });

  it("headersArray() reports the setRequestHeader values of an XMLHttpRequest", async () => {
    const page = createPage();
    const waiting = page.waitForRequest("**/title.html*", { timeout: 5_000 });
    sendXhr(assetUrl("?xhr-headers-array"), {
      headers: [
        ["X-Repeated", "one"],
        ["x-repeated", "two"],
      ],
    });
    const request = await waiting;

    expect(await request.headersArray()).toEqual([
      { name: "x-repeated", value: "one, two" },
    ]);
  });
});
