import { describe, expect, it } from "vitest";

import { createPage, type Request } from "../../src/index";
import { contractUrl, restoreFetch } from "./network";

/**
 * `Request` carries only what the current document can fill. The members
 * Playwright fills from the browser's network layer are absent from the type,
 * so reading one is a compile error rather than invented data.
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

  it("reports the url it waited for when it times out", async () => {
    const page = createPage();
    await expect(
      page.waitForRequest("never-requested.css", { timeout: 1 })
    ).rejects.toThrow(
      'page.waitForRequest: Timeout 1ms exceeded while waiting for request "never-requested.css"'
    );
    await expect(
      page.waitForRequest(/never-requested/i, { timeout: 1 })
    ).rejects.toThrow("waiting for request /never-requested/i");
    await expect(
      page.waitForRequest(() => false, { timeout: 1 })
    ).rejects.toThrow('waiting for event "request"');
  });

  it("rejects options the pinned signature does not have", async () => {
    await expect(
      createPage().waitForRequest("**/*", {
        predicate: () => true,
      } as unknown as { timeout?: number })
    ).rejects.toThrow("predicate");
  });
});
