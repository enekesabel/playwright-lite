import { describe, expect, it } from "vitest";

import { createPage, type Request } from "../../src/index";
import {
  assetUrl,
  contractUrl,
  restoreFetch,
  restoreXhr,
  sendXhr,
} from "./network";

/**
 * The exported `Request` type carries only what the current document can fill.
 * `createPage` still returns Playwright's `Page`, so a script that type-checks
 * against Playwright type-checks here; annotating with this type is opt-in.
 */
type AbsentOnRequest = Extract<
  keyof Request,
  | "allHeaders"
  | "headersArray"
  | "frame"
  | "redirectedFrom"
  | "redirectedTo"
  | "serviceWorker"
  | "sizes"
  | "timing"
>;

describe("Page.waitForRequest", () => {
  restoreFetch();

  it("exposes only the members the document can fill", () => {
    const absent: [AbsentOnRequest] extends [never] ? true : false = true;
    expect(absent).toBe(true);
  });

  it("keeps Playwright's Page type, so an unfilled member compiles and throws", async () => {
    const page = createPage();
    const waiting = page.waitForRequest("**/untyped", { timeout: 5_000 });
    void window.fetch(contractUrl("./untyped"));
    const request = await waiting;

    // `timing()` is on Playwright's `Request`, so this type-checks. It is not
    // implemented here, and reports that the way any missing method does.
    expect(() => request.timing()).toThrow(TypeError);
  });

  it("starts observing fetch on the call, before the document fetches", async () => {
    const native = window.fetch;
    const page = createPage();
    const waiting = page.waitForRequest(contractUrl("./waited"), {
      timeout: 5_000,
    });
    expect(window.fetch).not.toBe(native);

    void window.fetch(contractUrl("./waited"));
    expect((await waiting).url()).toBe(contractUrl("./waited"));
    expect(window.fetch).toBe(native);
  });

  it("matches a glob, a regular expression and a predicate on the Request", async () => {
    const page = createPage();
    const byGlob = page.waitForRequest("**/globbed", { timeout: 5_000 });
    const byRegExp = page.waitForRequest(/\/globbed$/, { timeout: 5_000 });
    const byPredicate = page.waitForRequest(
      (request) => request.method() === "POST",
      { timeout: 5_000 }
    );

    void window.fetch(contractUrl("./globbed"));
    void window.fetch(contractUrl("./posted"), {
      method: "POST",
      body: '{"foo":"bar"}',
    });

    expect((await byGlob).url()).toBe(contractUrl("./globbed"));
    expect((await byRegExp).url()).toBe(contractUrl("./globbed"));
    const posted = await byPredicate;
    expect(posted.url()).toBe(contractUrl("./posted"));
    expect(posted.postData()).toBe('{"foo":"bar"}');
    expect(posted.postDataJSON()).toEqual({ foo: "bar" });
    expect(posted.postDataBuffer()).toBeInstanceOf(Uint8Array);
  });

  it("parses a form-urlencoded body the way the pinned client does", async () => {
    const page = createPage();
    const waiting = page.waitForRequest("**/form", { timeout: 5_000 });
    void window.fetch(contractUrl("./form"), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "foo=bar&baz=123",
    });
    expect((await waiting).postDataJSON()).toEqual({ foo: "bar", baz: "123" });
  });

  it("reports a regular expression and a predicate in its timeout", async () => {
    const page = createPage();
    await expect(
      page.waitForRequest(/never-requested/i, { timeout: 1 })
    ).rejects.toThrow("waiting for request /never-requested/i");
    await expect(
      page.waitForRequest(() => false, { timeout: 1 })
    ).rejects.toThrow('waiting for event "request"');
  });

  // ── XMLHttpRequest ──────────────────────────────────────────────

  restoreXhr();

  it("matches an XMLHttpRequest and reads the body send handed over", async () => {
    const page = createPage();
    const asText = page.waitForRequest(/\?xhr-text$/, { timeout: 5_000 });
    const asParams = page.waitForRequest(/\?xhr-params$/, { timeout: 5_000 });
    const asBytes = page.waitForRequest(
      (request) => request.url().endsWith("?xhr-bytes"),
      { timeout: 5_000 }
    );

    sendXhr(assetUrl("?xhr-text"), {
      method: "POST",
      headers: [["content-type", "application/json"]],
      body: '{"foo":"bar"}',
    });
    sendXhr(assetUrl("?xhr-params"), {
      method: "POST",
      body: new URLSearchParams({ foo: "bar" }),
    });
    sendXhr(assetUrl("?xhr-bytes"), {
      method: "POST",
      body: new TextEncoder().encode("bytes"),
    });

    const text = await asText;
    expect(text.resourceType()).toBe("xhr");
    expect(text.postData()).toBe('{"foo":"bar"}');
    expect(text.postDataJSON()).toEqual({ foo: "bar" });
    expect((await asParams).postData()).toBe("foo=bar");
    const bytes = await asBytes;
    expect(bytes.postData()).toBe("bytes");
    expect(bytes.postDataBuffer()).toEqual(new TextEncoder().encode("bytes"));
  });

  it("parses an XMLHttpRequest form-urlencoded body the way the pinned client does", async () => {
    const page = createPage();
    const waiting = page.waitForRequest(/\?xhr-form$/, { timeout: 5_000 });
    sendXhr(assetUrl("?xhr-form"), {
      method: "POST",
      headers: [
        ["content-type", "application/x-www-form-urlencoded; charset=UTF-8"],
      ],
      body: "foo=bar&baz=123",
    });

    expect((await waiting).postDataJSON()).toEqual({ foo: "bar", baz: "123" });
  });

  it("reports a Blob or FormData XMLHttpRequest body as no post data", async () => {
    const page = createPage();
    const asBlob = page.waitForRequest(/\?xhr-blob$/, { timeout: 5_000 });
    const asFormData = page.waitForRequest(/\?xhr-form-data$/, {
      timeout: 5_000,
    });

    sendXhr(assetUrl("?xhr-blob"), {
      method: "POST",
      body: new Blob(["blob-contents"]),
    });
    const formData = new FormData();
    formData.set("foo", "bar");
    sendXhr(assetUrl("?xhr-form-data"), { method: "POST", body: formData });

    // Both can only be read asynchronously, and postData() answers at once.
    const blob = await asBlob;
    expect(blob.postData()).toBe(null);
    expect(blob.postDataBuffer()).toBe(null);
    expect((await asFormData).postData()).toBe(null);
  });
});
