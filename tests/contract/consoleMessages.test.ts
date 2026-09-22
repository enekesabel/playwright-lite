import { describe, expect, it } from "vitest";

import { listenedPages } from "./pageEvents";

describe("Page.consoleMessages", () => {
  const createPage = listenedPages();

  it("returns nothing before the first call and the console.* calls made after it", async () => {
    const page = createPage();

    console.log("before");
    expect(await page.consoleMessages()).toEqual([]);

    console.log("after");
    const messages = await page.consoleMessages();
    expect(messages.map((m) => m.text())).toEqual(["after"]);
  });

  it("returns a snapshot: mutating the result does not affect later reads", async () => {
    const page = createPage();
    await page.consoleMessages();
    console.log("kept");

    const first = await page.consoleMessages();
    first.push(first[0]);

    const second = await page.consoleMessages();
    expect(second.map((m) => m.text())).toEqual(["kept"]);
  });

  it("bounds the buffer to the pinned limit, dropping the oldest tenth", async () => {
    const page = createPage();
    await page.consoleMessages();
    for (let i = 1; i <= 201; i++) console.log(`message${i}`);

    const messages = await page.consoleMessages();
    expect(messages).toHaveLength(181);
    expect(messages[messages.length - 1].text()).toBe("message201");
  });

  it('`filter: "all"` and the default `since-navigation` return the same messages', async () => {
    const page = createPage();
    await page.consoleMessages();
    console.log("one");
    console.log("two");

    const [all, sinceNavigation, defaulted] = await Promise.all([
      page.consoleMessages({ filter: "all" }),
      page.consoleMessages({ filter: "since-navigation" }),
      page.consoleMessages(),
    ]);
    const texts = (messages: Awaited<typeof all>) =>
      messages.map((m) => m.text());
    expect(texts(all)).toEqual(["one", "two"]);
    expect(texts(sinceNavigation)).toEqual(texts(all));
    expect(texts(defaulted)).toEqual(texts(all));
  });

  it("rejects an unsupported filter value", async () => {
    const page = createPage();
    await expect(
      page.consoleMessages({ filter: "unknown" as "all" })
    ).rejects.toThrow("filter: expected one of (all|since-navigation)");
  });

  it("buffers and emits a call once, whether or not a console listener is also subscribed", async () => {
    const page = createPage();
    await page.consoleMessages();
    const seen: string[] = [];
    page.on("console", (m) => seen.push(m.text()));

    console.log("once");

    const messages = await page.consoleMessages();
    expect(messages.map((m) => m.text())).toEqual(["once"]);
    expect(seen).toEqual(["once"]);
  });

  it("never observes a browser-generated console entry, such as a failed resource load", async () => {
    const page = createPage();
    await page.consoleMessages();

    const img = document.createElement("img");
    const failed = new Promise<void>((resolve) => {
      img.onerror = () => resolve();
    });
    img.src = new URL(
      `/tests/assets/does-not-exist-${Date.now()}.png`,
      location.origin
    ).href;
    document.body.appendChild(img);
    await failed;
    document.body.removeChild(img);

    expect(await page.consoleMessages()).toEqual([]);
  });
});
