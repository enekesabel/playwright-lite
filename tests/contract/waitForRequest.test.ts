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

  it("reports a regular expression and a predicate in its timeout", async () => {
    const page = createPage();
    await expect(
      page.waitForRequest(/never-requested/i, { timeout: 1 })
    ).rejects.toThrow("waiting for request /never-requested/i");
    await expect(
      page.waitForRequest(() => false, { timeout: 1 })
    ).rejects.toThrow('waiting for event "request"');
  });

  // ── Request bodies ──────────────────────────────────────────────

  restoreXhr();

  type BodyCase = {
    body: string;
    method?: string;
    contentType?: string;
    make: () => BodyInit;
    postData: string | null;
    postDataJSON?: unknown;
    /** `fetch` rejects a body on GET, so the case is XHR's alone. */
    xhrOnly?: boolean;
  };
  const bodyCases: BodyCase[] = [
    {
      body: "a JSON string",
      contentType: "application/json",
      make: () => '{"foo":"bar"}',
      postData: '{"foo":"bar"}',
      postDataJSON: { foo: "bar" },
    },
    {
      // The pinned client parses this content type instead of JSON.
      body: "a form-urlencoded string",
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      make: () => "foo=bar&baz=123",
      postData: "foo=bar&baz=123",
      postDataJSON: { foo: "bar", baz: "123" },
    },
    {
      body: "URLSearchParams",
      make: () => new URLSearchParams({ foo: "bar" }),
      postData: "foo=bar",
    },
    {
      body: "a typed array",
      make: () => new TextEncoder().encode("bytes"),
      postData: "bytes",
    },
    // Both can only be read asynchronously, and postData() answers at once.
    { body: "a Blob", make: () => new Blob(["blob"]), postData: null },
    {
      body: "FormData",
      make: () => {
        const formData = new FormData();
        formData.set("foo", "bar");
        return formData;
      },
      postData: null,
    },
    {
      // XMLHttpRequest ignores the send() body of a GET.
      body: "a body on GET",
      method: "GET",
      make: () => "ignored",
      postData: null,
      xhrOnly: true,
    },
  ];
  const send = {
    fetch: (url: string, c: BodyCase) =>
      void window.fetch(url, {
        method: c.method ?? "POST",
        headers: c.contentType ? { "content-type": c.contentType } : {},
        body: c.make(),
      }),
    XMLHttpRequest: (url: string, c: BodyCase) =>
      void sendXhr(url, {
        method: c.method ?? "POST",
        headers: c.contentType ? [["content-type", c.contentType]] : [],
        body: c.make() as XMLHttpRequestBodyInit,
      }),
  };
  const bodyRows = (["fetch", "XMLHttpRequest"] as const).flatMap((via) =>
    bodyCases
      .filter((c) => via === "XMLHttpRequest" || !c.xhrOnly)
      .map((c, index) => [`${c.body} via ${via}`, via, c, index] as const)
  );

  it.each(bodyRows)("reads %s", async (_, via, c, index) => {
    const page = createPage();
    const url = assetUrl(`?body-${via}-${index}`);
    const waiting = page.waitForRequest((request) => request.url() === url, {
      timeout: 5_000,
    });
    send[via](url, c);
    const request = await waiting;

    expect(request.postData()).toBe(c.postData);
    expect(request.postDataBuffer()).toEqual(
      c.postData === null ? null : new TextEncoder().encode(c.postData)
    );
    if (c.postDataJSON !== undefined)
      expect(request.postDataJSON()).toEqual(c.postDataJSON);
  });
});
