import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import {
  listenerFailures,
  report,
  restoreURL,
  swallowWindowErrors,
} from "./pageEvents";
import {
  assetUrl,
  contractUrl,
  networkPages,
  restoreFetch,
  restoreXhr,
  sendXhr,
  xhrMethods,
} from "./network";

swallowWindowErrors();
restoreURL();

const reject = (reason: unknown) =>
  window.dispatchEvent(
    new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason,
    })
  );

describe("Page.on", () => {
  it("accepts an unknown event name silently", () => {
    const page = createPage();
    expect(page.on("unknown" as "load", () => {})).toBe(page);
  });

  it("delivers a thrown Error as the pageerror payload", () => {
    const page = createPage();
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    const thrown = new Error("boom");
    report(thrown);
    expect(errors).toEqual([thrown]);
  });

  it("wraps a non-Error rejection reason like the pinned protocol mapping", () => {
    const page = createPage();
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    reject({});
    reject("Custom: detail");
    report({ name: "Named", message: "ignored" });
    expect(errors.map((e) => [e.name, e.message, e.stack])).toEqual([
      ["", "Object", ""],
      ["Custom", "detail", ""],
      ["Named", "Object", ""],
    ]);
  });

  it("logs a throwing or rejecting listener and keeps delivering to the others", async () => {
    const logged = vi
      .spyOn(window.console, "error")
      .mockImplementation(() => {});
    const page = createPage();
    const payloads: Error[] = [];
    page.on("pageerror", () => {
      throw new Error("listener failed");
    });
    page.on("pageerror", () => {
      throw undefined;
    });
    page.on("pageerror", () => Promise.reject(new Error("listener rejected")));
    page.on("pageerror", (error) => payloads.push(error));

    report(new Error("first"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(payloads.map((e) => e.message)).toEqual(["first"]);
    const prefix = 'page.on("pageerror"): listener failed';
    expect(listenerFailures(logged)).toEqual([
      [prefix, expect.objectContaining({ message: "listener failed" })],
      [prefix, undefined],
      [prefix, expect.objectContaining({ message: "listener rejected" })],
    ]);
  });

  const nextNavigation = (page: ReturnType<typeof createPage>) =>
    page.waitForEvent("framenavigated", { timeout: 500 });

  it("fires framenavigated with the main frame on pushState, replaceState, hash change and back", async () => {
    const start = location.href;
    const page = createPage();
    const frames: unknown[] = [];
    page.on("framenavigated", (frame) => frames.push(frame));

    let navigated = nextNavigation(page);
    history.pushState({}, "", "#pushed");
    await navigated;
    expect(page.url()).toBe(`${start}#pushed`);

    navigated = nextNavigation(page);
    history.replaceState({}, "", "#replaced");
    await navigated;
    expect(page.url()).toBe(`${start}#replaced`);

    navigated = nextNavigation(page);
    location.hash = "#hash";
    await navigated;
    expect(page.url()).toBe(`${start}#hash`);

    navigated = nextNavigation(page);
    history.back();
    await navigated;
    expect(page.url()).toBe(`${start}#replaced`);

    expect(frames).toHaveLength(4);
    for (const frame of frames) expect(frame).toBe(page.mainFrame());
  });

  it("does not fire framenavigated while the URL stays the same", async () => {
    const page = createPage();
    const listener = vi.fn();
    page.on("framenavigated", listener);

    history.replaceState({ changed: true }, "", location.href);
    await expect(nextNavigation(page)).rejects.toThrow(
      'Timeout 500ms exceeded while waiting for event "framenavigated"'
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers framenavigated to a listener and a concurrent waitForURL alike", async () => {
    const page = createPage();
    const frames: unknown[] = [];
    page.on("framenavigated", (frame) => frames.push(frame));
    const navigated = nextNavigation(page);
    const reached = page.waitForURL((url) => url.hash === "#shared", {
      waitUntil: "commit",
      timeout: 500,
    });

    history.pushState({}, "", "#shared");
    await navigated;
    await expect(reached).resolves.toBeUndefined();
    expect(frames).toEqual([page.mainFrame()]);
  });

  // ── Network events ──────────────────────────────────────────────

  restoreFetch();
  const networkPage = networkPages();

  it("leaves window.fetch alone until the first network listener", () => {
    const before = window.fetch;
    const page = networkPage();
    page.on("pageerror", () => {});
    expect(window.fetch).toBe(before);
    page.on("request", () => {});
    expect(window.fetch).not.toBe(before);
  });

  it("keeps the wrapped fetch indistinguishable from the original", () => {
    const before = window.fetch;
    networkPage().on("request", () => {});
    const wrapped = window.fetch;
    expect(wrapped).not.toBe(before);
    expect(wrapped.name).toBe(before.name);
    expect(wrapped.length).toBe(before.length);
    const source = Function.prototype.toString.call(wrapped);
    expect(source).toContain("[native code]");
    expect(source).not.toContain("=>");
  });

  it("forwards the receiver to the function it wrapped", async () => {
    const receivers: unknown[] = [];
    window.fetch = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response("ok"));
    } as typeof fetch;
    networkPage().on("request", () => {});

    const host = { fetch: window.fetch };
    await host.fetch(contractUrl("."));
    await window.fetch.call(undefined, contractUrl("."));

    expect(receivers).toEqual([host, undefined]);
  });

  it("lets a rejected receiver throw before anything is reported", () => {
    // Chromium's own `fetch` ignores its receiver, so the stand-in supplies
    // the Web IDL check whose TypeError must still reach the caller.
    window.fetch = function (this: unknown) {
      if (this !== window) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("ok"));
    } as typeof fetch;
    const page = networkPage();
    const seen: unknown[] = [];
    page.on("request", (request) => seen.push(request));

    expect(() => window.fetch.call({}, contractUrl("."))).toThrow(TypeError);
    expect(seen).toEqual([]);
  });

  it("reports request, response and requestfinished in the pinned order", async () => {
    const page = networkPage();
    const url = contractUrl("./ordered");
    // A request another test started can still answer during this one, so
    // only the events of this request are recorded.
    const events: string[] = [];
    const record = (name: string) => (target: { url(): string }) => {
      if (target.url() === url) events.push(name);
    };
    page.on("request", record("request"));
    page.on("response", record("response"));
    page.on("requestfinished", record("requestfinished"));
    const finished = page.waitForEvent("requestfinished", {
      predicate: (request) => request.url() === url,
      timeout: 5_000,
    });

    await window.fetch(url);
    await finished;

    expect(events).toEqual(["request", "response", "requestfinished"]);
  });

  it("reports a fetch with the fields the document can fill", async () => {
    const page = networkPage();
    const waiting = page.waitForEvent("request", { timeout: 5_000 });
    void window.fetch(contractUrl("./contract-fetch#fragment"), {
      headers: { "x-contract": "yes" },
    });
    const request = await waiting;

    expect(request.url()).toBe(contractUrl("./contract-fetch"));
    expect(request.resourceType()).toBe("fetch");
    expect(request.method()).toBe("GET");
    expect(request.isNavigationRequest()).toBe(false);
    expect(request.headers()["x-contract"]).toBe("yes");
    expect(await request.headerValue("X-Contract")).toBe("yes");
    expect(request.failure()).toBe(null);
    expect(request.postData()).toBe(null);
  });

  it("reports a failed fetch as requestfailed with Playwright's failure shape", async () => {
    const page = networkPage();
    const failed = page.waitForEvent("requestfailed", { timeout: 5_000 });
    await expect(
      window.fetch("http://localhost:1/unreachable")
    ).rejects.toThrow();
    const request = await failed;

    expect(request.failure()).toEqual({
      errorText: expect.stringContaining("TypeError"),
    });
    expect(await request.response()).toBe(null);
  });

  // ── XMLHttpRequest ──────────────────────────────────────────────

  restoreXhr();

  it("leaves the XMLHttpRequest methods alone until the first network listener", () => {
    const before = xhrMethods();
    const page = networkPage();
    page.on("pageerror", () => {});
    for (const name of ["open", "setRequestHeader", "send"] as const)
      expect(xhrMethods()[name]).toBe(before[name]);

    page.on("request", () => {});
    for (const name of ["open", "setRequestHeader", "send"] as const)
      expect(xhrMethods()[name]).not.toBe(before[name]);
  });

  it("keeps the wrapped XMLHttpRequest methods indistinguishable from the originals", () => {
    const before = xhrMethods();
    networkPage().on("request", () => {});
    const wrapped = xhrMethods();

    for (const name of ["open", "setRequestHeader", "send"] as const) {
      expect(wrapped[name].name).toBe(before[name].name);
      expect(wrapped[name].length).toBe(before[name].length);
      const source = Function.prototype.toString.call(wrapped[name]);
      expect(source).toContain("[native code]");
      expect(source).not.toContain("=>");
    }
  });

  it("reports an XMLHttpRequest as request, response and requestfinished in the pinned order", async () => {
    const page = networkPage();
    const url = assetUrl("?xhr-ordered");
    const events: string[] = [];
    const record = (name: string) => (target: { url(): string }) => {
      if (target.url() === url) events.push(name);
    };
    page.on("request", record("request"));
    page.on("response", record("response"));
    page.on("requestfinished", record("requestfinished"));
    const finished = page.waitForEvent("requestfinished", {
      predicate: (request) => request.url() === url,
      timeout: 5_000,
    });

    const { ended } = sendXhr(url);
    expect(await ended).toBe("load");
    await finished;

    expect(events).toEqual(["request", "response", "requestfinished"]);
  });

  it("reports an XMLHttpRequest with the fields the document can fill", async () => {
    const page = networkPage();
    const waiting = page.waitForEvent("request", { timeout: 5_000 });
    sendXhr(`${assetUrl("?xhr-fields")}#fragment`, {
      method: "post",
      headers: [
        ["x-contract", "yes"],
        ["x-repeated", "one"],
        ["x-repeated", "two"],
        // The browser drops this forbidden name without an error.
        ["cookie", "never-sent=1"],
      ],
      body: "hello",
    });
    const request = await waiting;

    expect(request.url()).toBe(assetUrl("?xhr-fields"));
    expect(request.resourceType()).toBe("xhr");
    // `open` was given "post"; XMLHttpRequest uppercases the known methods.
    expect(request.method()).toBe("POST");
    expect(request.isNavigationRequest()).toBe(false);
    expect(request.headers()["x-contract"]).toBe("yes");
    // Per XMLHttpRequest, a repeated name appends instead of replacing.
    expect(request.headers()["x-repeated"]).toBe("one, two");
    expect(await request.headerValue("X-Contract")).toBe("yes");
    expect(request.headers()).not.toHaveProperty("cookie");
    expect(request.failure()).toBe(null);
    expect(request.postData()).toBe("hello");
  });

  it("reports a failed XMLHttpRequest as requestfailed with Playwright's failure shape", async () => {
    const page = networkPage();
    const failed = page.waitForEvent("requestfailed", { timeout: 5_000 });
    const { ended } = sendXhr("http://localhost:1/unreachable");
    expect(await ended).toBe("error");
    const request = await failed;

    expect(request.failure()).toEqual({ errorText: "XMLHttpRequest: error" });
    expect(await request.response()).toBe(null);
  });

  it("reports an aborted XMLHttpRequest as requestfailed", async () => {
    const page = networkPage();
    const failed = page.waitForEvent("requestfailed", { timeout: 5_000 });
    const { xhr, ended } = sendXhr(assetUrl("?xhr-aborted"));
    xhr.abort();
    expect(await ended).toBe("abort");

    expect((await failed).failure()).toEqual({
      errorText: "XMLHttpRequest: abort",
    });
  });

  it("reports an XMLHttpRequest opened again while in flight as aborted", async () => {
    const page = networkPage();
    const first = assetUrl("?xhr-reopened-first");
    const second = assetUrl("?xhr-reopened-second");
    const events: string[] = [];
    const record = (event: string) => (request: { url(): string }) => {
      const query = new URL(request.url()).search;
      if (query.startsWith("?xhr-reopened")) events.push(`${event}:${query}`);
    };
    page.on("request", record("request"));
    page.on("requestfinished", record("requestfinished"));
    page.on("requestfailed", record("requestfailed"));
    const finished = page.waitForEvent("requestfinished", {
      predicate: (request) => request.url() === second,
      timeout: 5_000,
    });

    const xhr = new XMLHttpRequest();
    const ended = new Promise((resolve) =>
      xhr.addEventListener("loadend", resolve)
    );
    xhr.open("GET", first);
    xhr.send();
    xhr.open("GET", second);
    xhr.send();
    await ended;
    await finished;

    expect(events).toEqual([
      "request:?xhr-reopened-first",
      "requestfailed:?xhr-reopened-first",
      "request:?xhr-reopened-second",
      "requestfinished:?xhr-reopened-second",
    ]);
  });

  it("reports an XMLHttpRequest the document opens again once it is done as finished", async () => {
    const page = networkPage();
    const url = assetUrl("?xhr-polled");
    const events: string[] = [];
    page.on("requestfinished", (request) => {
      if (request.url() === url) events.push("requestfinished");
    });
    page.on("requestfailed", (request) => {
      if (request.url() === url) events.push("requestfailed");
    });

    const xhr = new XMLHttpRequest();
    // This handler runs before the observation sees DONE.
    xhr.onreadystatechange = () => {
      if (xhr.readyState === xhr.DONE)
        xhr.open("GET", assetUrl("?xhr-polled-again"));
    };
    xhr.open("GET", url);
    xhr.send();
    await expect.poll(() => events).toEqual(["requestfinished"]);
  });

  it("reports nothing for a send the platform rejects", () => {
    const page = networkPage();
    const seen: unknown[] = [];
    page.on("request", (request) => seen.push(request));

    // `send` before `open` is the platform's InvalidStateError, and the
    // wrapper must let it through without reporting a request.
    expect(() => new XMLHttpRequest().send()).toThrow(DOMException);
    expect(seen).toEqual([]);
  });

  it("reports nothing for an XMLHttpRequest opened before the first listener", async () => {
    const page = networkPage();
    const xhr = new XMLHttpRequest();
    xhr.open("GET", assetUrl("?xhr-early"));
    const seen: string[] = [];
    page.on("request", (request) => seen.push(request.url()));

    const ended = new Promise((resolve) =>
      xhr.addEventListener("loadend", resolve)
    );
    xhr.send();
    await ended;

    expect(seen).toEqual([]);
  });
});
