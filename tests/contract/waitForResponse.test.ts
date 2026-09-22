import { describe, expect, it } from "vitest";

import { createPage, type Response } from "../../src/index";
import { contractUrl, recordedFetch, restoreFetch } from "./network";

/**
 * `Response` carries only what the current document can fill. The members
 * Playwright fills from the browser's network layer are absent from the type.
 */
type AbsentOnResponse = Extract<
  keyof Response,
  | "allHeaders"
  | "headersArray"
  | "headerValues"
  | "frame"
  | "fromServiceWorker"
  | "httpVersion"
  | "securityDetails"
  | "serverAddr"
>;

describe("Page.waitForResponse", () => {
  restoreFetch();

  it("exposes only the members the document can fill", () => {
    const absent: [AbsentOnResponse] extends [never] ? true : false = true;
    expect(absent).toBe(true);
  });

  it("resolves with the response the document received", async () => {
    const page = createPage();
    const waiting = page.waitForResponse("**/contract-response", {
      timeout: 5_000,
    });
    void window.fetch(contractUrl("./contract-response"));
    const response = await waiting;

    expect(response.url()).toBe(contractUrl("./contract-response"));
    expect(typeof response.status()).toBe("number");
    expect(typeof response.statusText()).toBe("string");
    expect(response.ok()).toBe(
      response.status() === 0 ||
        (response.status() >= 200 && response.status() <= 299)
    );
    expect(response.request().url()).toBe(response.url());
  });

  it("reports the status and the headers the browser exposed", async () => {
    recordedFetch("body", {
      status: 201,
      statusText: "Created",
      headers: { "X-Contract": "yes" },
    });
    const page = createPage();
    // A Response the page built itself has no URL, so this waits on the
    // request it answers instead of on `response.url()`.
    const waiting = page.waitForResponse(
      (response) => response.request().url().endsWith("/headers"),
      { timeout: 5_000 }
    );
    void window.fetch(contractUrl("./headers"));
    const response = await waiting;

    expect(response.status()).toBe(201);
    expect(response.statusText()).toBe("Created");
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-contract"]).toBe("yes");
    expect(await response.headerValue("X-Contract")).toBe("yes");
    expect(await response.headerValue("absent")).toBe(null);
  });

  it("reads the body even though the document consumed it", async () => {
    const page = createPage();
    const waiting = page.waitForResponse("**/contract-body", {
      timeout: 5_000,
    });
    const consumed = window
      .fetch(contractUrl("./contract-body"))
      .then((r) => r.text());
    const response = await waiting;

    expect(await response.text()).toBe(await consumed);
    expect(await response.body()).toBeInstanceOf(Uint8Array);
    expect(await response.finished()).toBe(null);
  });

  it("awaits an asynchronous predicate against the Response", async () => {
    const page = createPage();
    const waiting = page.waitForResponse(
      async (response) => {
        const text = await response.text();
        return text.length >= 0 && response.url().endsWith("/predicated");
      },
      { timeout: 5_000 }
    );
    void window.fetch(contractUrl("./skipped"));
    void window.fetch(contractUrl("./predicated"));

    expect((await waiting).url()).toBe(contractUrl("./predicated"));
  });

  it("reports the url it waited for when it times out", async () => {
    const page = createPage();
    await expect(
      page.waitForResponse("foo.css", { timeout: 1 })
    ).rejects.toThrow(
      'page.waitForResponse: Timeout 1ms exceeded while waiting for response "foo.css"'
    );
    await expect(
      page.waitForResponse(/foo.css/i, { timeout: 1 })
    ).rejects.toThrow("waiting for response /foo.css/i");
  });
});
