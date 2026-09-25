import { afterEach, describe, expect, it } from "vitest";
import type { FileChooser } from "@playwright/test";

import { createPage } from "../../src/index";
import { listenedPages } from "./pageEvents";

// Playwright's payload type uses Node Buffer; its browser form is a Uint8Array.
const payload = (name: string, text = "contents") => ({
  name,
  mimeType: "text/plain",
  buffer: new TextEncoder().encode(text) as Buffer,
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FileChooser", () => {
  const listenedPage = listenedPages();

  /** The choosers `page` reports from now on. */
  function choosers(page: ReturnType<typeof createPage>) {
    const seen: FileChooser[] = [];
    page.on("filechooser", (chooser) => seen.push(chooser));
    return seen;
  }

  it("reports an adapter click on a file input with its page, element and multiplicity", async () => {
    document.body.innerHTML = "<input type=file multiple>";
    const page = listenedPage();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click("input"),
    ]);

    expect(chooser.page()).toBe(page);
    expect(chooser.isMultiple()).toBe(true);
    expect(chooser.element()).toBe(chooser.element());
    await expect(
      chooser.element().evaluate((input) => input === document.body.firstChild)
    ).resolves.toBe(true);
  });

  it("reports the click a label forwards to its file input", async () => {
    document.body.innerHTML = "<label>Upload <input type=file></label>";
    const page = listenedPage();
    const seen = choosers(page);

    await page.click("text=Upload");

    expect(seen.map((chooser) => chooser.isMultiple())).toEqual([false]);
  });

  it("reports the page's own click() and showPicker(), cancelling the click once the input's listeners have run", () => {
    document.body.innerHTML = "<input type=file>";
    const input = document.querySelector("input")!;
    const seen = choosers(listenedPage());
    const prevented: [string, boolean][] = [];
    const record = (where: string) => (event: Event) =>
      prevented.push([where, event.defaultPrevented]);
    const documentListener = new AbortController();
    input.addEventListener("click", record("input"));
    document.addEventListener("click", record("document"), {
      signal: documentListener.signal,
    });

    input.click();
    input.showPicker();
    documentListener.abort();

    expect(prevented).toEqual([
      ["input", false],
      ["document", true],
    ]);
    expect(seen).toHaveLength(2);
  });

  it("reports a click the input's own listener stops, and a dispatched click that does not bubble", async () => {
    document.body.innerHTML = "<input type=file>";
    const input = document.querySelector("input")!;
    input.addEventListener("click", (event) => event.stopPropagation());
    const page = listenedPage();
    const seen = choosers(page);

    await page.click("input");
    const dispatched = input.dispatchEvent(
      new MouseEvent("click", { cancelable: true })
    );

    expect(dispatched).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it("reports a click an ancestor cancels while it bubbles", () => {
    document.body.innerHTML = "<div><input type=file></div>";
    document
      .querySelector("div")!
      .addEventListener("click", (event) => event.preventDefault());
    const seen = choosers(listenedPage());

    document.querySelector("input")!.click();

    expect(seen).toHaveLength(1);
  });

  it("reports click() on an input outside the document and sets its files", async () => {
    const page = listenedPage();
    const input = document.createElement("input");
    input.type = "file";
    const events: string[] = [];
    for (const type of ["input", "change"])
      input.addEventListener(type, (event) =>
        events.push(`${event.type}:${event.bubbles}`)
      );
    const chosen = page.waitForEvent("filechooser");

    input.click();
    await (await chosen).setFiles(payload("note.txt", "hello"));

    expect(events).toEqual(["input:true", "change:true"]);
    expect(input.files![0]!.name).toBe("note.txt");
    await expect(input.files![0]!.text()).resolves.toBe("hello");
  });

  it("reports click() on an input inside a closed shadow root once", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<input type=file>";
    const seen = choosers(listenedPage());

    root.querySelector("input")!.click();

    expect(seen).toHaveLength(1);
  });

  it("reports nothing for a cancelled click, a disabled input or another input type", async () => {
    document.body.innerHTML =
      "<input id=cancelled type=file><input id=disabled type=file disabled><input id=text>";
    document
      .getElementById("cancelled")!
      .addEventListener("click", (event) => event.preventDefault());
    const page = listenedPage();
    const seen = choosers(page);

    await page.click("#cancelled");
    document.querySelector<HTMLInputElement>("#disabled")!.click();
    document.querySelector<HTMLInputElement>("#text")!.click();
    document
      .getElementById("cancelled")!
      .dispatchEvent(new Event("click", { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it("hands one chooser to every listener of a page", async () => {
    document.body.innerHTML = "<input type=file>";
    const page = listenedPage();
    const both = Promise.all([
      page.waitForEvent("filechooser"),
      page.waitForEvent("filechooser"),
    ]);

    document.querySelector("input")!.click();
    const [first, second] = await both;

    expect(first).toBe(second);
  });

  it("replaces the files, and clears them with an empty list", async () => {
    document.body.innerHTML = "<input type=file multiple>";
    const input = document.querySelector("input")!;
    const page = listenedPage();
    const chosen = page.waitForEvent("filechooser");
    input.click();
    const chooser = await chosen;

    await chooser.setFiles([payload("a.txt"), payload("b.txt")]);
    expect([...input.files!].map((file) => file.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);
    await chooser.setFiles([]);
    expect(input.files).toHaveLength(0);
  });

  it("rejects file paths and several files for a single-file input", async () => {
    document.body.innerHTML = "<input type=file>";
    const page = listenedPage();
    const chosen = page.waitForEvent("filechooser");
    document.querySelector("input")!.click();
    const chooser = await chosen;

    await expect(chooser.setFiles("/tmp/file.txt")).rejects.toThrow(
      "setFiles: file paths are not supported; pass in-memory Playwright payloads."
    );
    await expect(
      chooser.setFiles([payload("a.txt"), payload("b.txt")])
    ).rejects.toThrow("Non-multiple file input can only accept single file");
    expect(document.querySelector("input")!.files).toHaveLength(0);
  });

  it("rejects setFiles once its page has closed", async () => {
    document.body.innerHTML = "<input type=file>";
    const page = listenedPage();
    const chosen = page.waitForEvent("filechooser");
    document.querySelector("input")!.click();
    const chooser = await chosen;

    await page.close();

    await expect(chooser.setFiles([])).rejects.toThrow(
      "fileChooser.setFiles: Target page, context or browser has been closed"
    );
  });
});
