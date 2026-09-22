import { describe, expect, it, vi } from "vitest";

import { createPage } from "../../src/index";
import {
  listenerFailures,
  report,
  restoreURL,
  swallowWindowErrors,
} from "./pageEvents";
import { contractUrl, networkPages, restoreFetch } from "./network";
import { consolePages, restoreConsole } from "./console";

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

  // ── Console events ──────────────────────────────────────────────

  restoreConsole();
  const consolePage = consolePages();

  it("leaves console.log alone until the first console listener", () => {
    const before = console.log;
    const page = consolePage();
    page.on("pageerror", () => {});
    expect(console.log).toBe(before);
    page.on("console", () => {});
    expect(console.log).not.toBe(before);
  });

  it("keeps the wrapped console.log indistinguishable from the original", () => {
    const before = console.log;
    consolePage().on("console", () => {});
    const wrapped = console.log;
    expect(wrapped).not.toBe(before);
    expect(wrapped.name).toBe(before.name);
    expect(wrapped.length).toBe(before.length);
    const source = Function.prototype.toString.call(wrapped);
    expect(source).toContain("[native code]");
    expect(source).not.toContain("=>");
  });

  it("forwards the receiver and arguments to the method it wrapped untouched", () => {
    const receivers: unknown[] = [];
    const seenArgs: unknown[][] = [];
    console.log = function (this: unknown, ...args: unknown[]) {
      receivers.push(this);
      seenArgs.push(args);
    } as typeof console.log;
    consolePage().on("console", () => {});

    const host = { log: console.log };
    host.log("via host", 1);
    console.log.call(undefined, "via call", 2);

    expect(receivers).toEqual([host, undefined]);
    expect(seenArgs).toEqual([
      ["via host", 1],
      ["via call", 2],
    ]);
  });

  it("reports type, text and args for a console.log call", () => {
    const page = consolePage();
    const messages: { type: string; text: string }[] = [];
    page.on("console", (message) => {
      messages.push({ type: message.type(), text: message.text() });
    });

    console.log("hello", 5, { foo: "bar" });

    expect(messages).toEqual([{ type: "log", text: "hello 5 {foo: bar}" }]);
  });

  it("logs a throwing console listener and keeps delivering to the others", () => {
    const logged = vi
      .spyOn(window.console, "error")
      .mockImplementation(() => {});
    const page = consolePage();
    const seen: string[] = [];
    page.on("console", () => {
      throw new Error("listener failed");
    });
    page.on("console", (m) => seen.push(m.text()));

    console.log("trigger");

    expect(seen).toEqual(["trigger"]);
    expect(listenerFailures(logged)).toEqual([
      [
        'page.on("console"): listener failed',
        expect.objectContaining({ message: "listener failed" }),
      ],
    ]);
  });

  it("does not recurse when a listener itself calls a wrapped console method", () => {
    const page = consolePage();
    const seen: string[] = [];
    page.on("console", (m) => {
      seen.push(m.text());
      // A listener that logs would otherwise re-enter this same listener.
      if (seen.length === 1) console.log("from listener");
    });

    console.log("trigger");

    expect(seen).toEqual(["trigger"]);
  });
});
