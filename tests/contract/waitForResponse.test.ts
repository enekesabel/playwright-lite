import { describe, expect, it } from "vitest";

import { createPage, type Response } from "../../src/index";
import {
  assetUrl,
  contractUrl,
  restoreFetch,
  restoreXhr,
  sendXhr,
} from "./network";

/**
 * The exported `Response` type carries only what the current document can
 * fill. `createPage` still returns Playwright's `Page`, so annotating with
 * this type is opt-in.
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

  it("keeps Playwright's Page type, so an unfilled member compiles and throws", async () => {
    const page = createPage();
    const waiting = page.waitForResponse("**/untyped", { timeout: 5_000 });
    void window.fetch(contractUrl("./untyped"));
    const response = await waiting;

    // `allHeaders()` is on Playwright's `Response`, so this type-checks.
    expect(() => response.allHeaders()).toThrow(TypeError);
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
    const page = createPage();
    const waiting = page.waitForResponse("**/title.html*", { timeout: 5_000 });
    void window.fetch(assetUrl("?headers"));
    const response = await waiting;

    expect(response.url()).toBe(assetUrl("?headers"));
    expect(response.status()).toBe(200);
    expect(response.statusText()).toBe("OK");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("text/html");
    expect(await response.headerValue("Content-Type")).toBe("text/html");
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

  it("reports a regular expression and a predicate in its timeout", async () => {
    const page = createPage();
    await expect(
      page.waitForResponse(/foo.css/i, { timeout: 1 })
    ).rejects.toThrow("waiting for response /foo.css/i");
    await expect(
      page.waitForResponse(() => false, { timeout: 1 })
    ).rejects.toThrow('waiting for event "response"');
  });

  // ── XMLHttpRequest ──────────────────────────────────────────────

  restoreXhr();

  it("resolves with the response an XMLHttpRequest received", async () => {
    const page = createPage();
    const waiting = page.waitForResponse(/\?xhr-response$/, {
      timeout: 5_000,
    });
    const { ended } = sendXhr(assetUrl("?xhr-response"));
    const response = await waiting;

    expect(response.url()).toBe(assetUrl("?xhr-response"));
    expect(response.status()).toBe(200);
    expect(response.statusText()).toBe("OK");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("text/html");
    expect(await response.headerValue("Content-Type")).toBe("text/html");
    expect(response.request().resourceType()).toBe("xhr");

    expect(await ended).toBe("load");
    expect(await response.finished()).toBe(null);
    expect(await response.text()).toContain("Woof-Woof");
    expect(await response.body()).toBeInstanceOf(Uint8Array);
  });

  it("reports that a response body the browser parsed away cannot be read", async () => {
    const page = createPage();
    const waiting = page.waitForResponse(/\?xhr-document$/, {
      timeout: 5_000,
    });
    const xhr = new XMLHttpRequest();
    xhr.responseType = "document";
    const ended = new Promise((resolve) =>
      xhr.addEventListener("loadend", resolve)
    );
    xhr.open("GET", assetUrl("?xhr-document"));
    xhr.send();

    const response = await waiting;
    await ended;
    expect(response.status()).toBe(200);
    await expect(response.body()).rejects.toThrow(
      'Response body is not available: the request set responseType "document".'
    );
  });
});
