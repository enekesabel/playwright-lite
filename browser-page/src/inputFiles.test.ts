import { afterEach, describe, expect, it } from "vitest";
import { createPage } from "./index";
import { inputFilePayloads } from "./inputFiles";

// Playwright's payload type uses Node Buffer. Its browser representation is a
// Uint8Array; no Buffer polyfill or browser-only public overload is necessary.
function payload(
  name = "test.txt",
  bytes = new TextEncoder().encode("contents")
) {
  return { name, mimeType: "text/plain", buffer: bytes as Buffer };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe.each(["Page", "Locator"] as const)("%s.setInputFiles", (owner) => {
  function upload() {
    const page = createPage();
    return owner === "Page"
      ? page.setInputFiles.bind(page, "#target")
      : page.locator("#target").setInputFiles.bind(page.locator("#target"));
  }

  it("assigns exact payload bytes and metadata through InjectedScript", async () => {
    document.body.innerHTML = '<input id="target" type="file">';
    const bytes = new Uint8Array([99, 0, 128, 255, 42, 99]).subarray(1, 5);
    await upload()(payload("binary.txt", bytes));
    const files = document.querySelector<HTMLInputElement>("input")!.files!;
    expect(files.length).toBe(1);
    expect(files[0]!.name).toBe("binary.txt");
    expect(files[0]!.type).toBe("text/plain");
    expect(new Uint8Array(await files[0]!.arrayBuffer())).toEqual(bytes);
  });

  it("replaces multiple files, emits events on each call, and clears with []", async () => {
    document.body.innerHTML = '<input id="target" type="file" multiple>';
    const input = document.querySelector<HTMLInputElement>("input")!;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    const setFiles = upload();
    await setFiles([payload("a.txt"), payload("b.txt")]);
    expect(Array.from(input.files!, (file) => file.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);
    await setFiles(payload("c.txt"));
    expect(Array.from(input.files!, (file) => file.name)).toEqual(["c.txt"]);
    await setFiles([]);
    expect(input.files!.length).toBe(0);
    expect(events).toEqual([
      "input",
      "change",
      "input",
      "change",
      "input",
      "change",
    ]);
  });

  it("retargets labels and does not require enabled or visible input", async () => {
    document.body.innerHTML =
      '<label id="target" for="file">Upload</label><input id="file" type="file" disabled hidden>';
    await upload()(payload());
    expect(
      await document.querySelector<HTMLInputElement>("input")!.files![0]!.text()
    ).toBe("contents");
  });

  it("waits for a late input and applies timeout", async () => {
    const setFiles = upload();
    await expect(setFiles(payload(), { timeout: 30 })).rejects.toThrow(
      "Timeout 30ms exceeded"
    );
    const pending = setFiles(payload(), { timeout: 1000 });
    document.body.innerHTML = '<input id="target" type="file">';
    await pending;
    expect(
      document.querySelector<HTMLInputElement>("input")!.files!.length
    ).toBe(1);
  });

  it("rejects paths and browser-only values without changing an existing selection", async () => {
    document.body.innerHTML = '<input id="target" type="file">';
    const setFiles = upload();
    await setFiles(payload());
    for (const files of [
      "file.txt",
      ["file.txt"],
      [payload(), "file.txt"],
      new File(["a"], "a.txt"),
      new Blob(["a"]),
    ]) {
      // Deliberately exercise invalid shapes outside the public PW signature.
      await expect(
        setFiles(files as Parameters<typeof setFiles>[0])
      ).rejects.toThrow(/not supported/);
      expect(
        document.querySelector<HTMLInputElement>("input")!.files![0]!.name
      ).toBe("test.txt");
    }
  });

  it("validates input type, multiplicity, and directory restrictions", async () => {
    const setFiles = upload();
    document.body.innerHTML = '<div id="target"></div>';
    await expect(setFiles(payload())).rejects.toThrow(
      "Node is not an HTMLInputElement"
    );
    document.body.innerHTML = '<input id="target" type="text">';
    await expect(setFiles(payload())).rejects.toThrow(
      "Not an input[type=file] element"
    );
    document.body.innerHTML = '<input id="target" type="file">';
    await expect(setFiles([payload(), payload()])).rejects.toThrow(
      "Non-multiple file input can only accept single file"
    );
    document.body.innerHTML = '<input id="target" type="file" webkitdirectory>';
    await expect(setFiles(payload())).rejects.toThrow(
      "[webkitdirectory] input requires passing a path to a directory"
    );
  });
});

it("keeps Locator uploads strict while Page supports strict opt-in", async () => {
  document.body.innerHTML = '<input type="file"><input type="file">';
  const page = createPage();
  await expect(page.locator("input").setInputFiles(payload())).rejects.toThrow(
    "strict mode violation"
  );
  await expect(
    page.setInputFiles("input", payload(), { strict: true })
  ).rejects.toThrow("strict mode violation");
  await page.setInputFiles("input", payload());
  expect(
    Array.from(
      document.querySelectorAll("input"),
      (input) => input.files!.length
    )
  ).toEqual([1, 0]);
});

it("preserves the upstream input/change shadow DOM event contract", async () => {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.querySelector("#host")!;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<input type="file">';
  const events: string[] = [];
  const outerEvents: string[] = [];
  for (const name of ["input", "change"]) {
    shadow
      .querySelector("input")!
      .addEventListener(name, (event) =>
        events.push(`${event.type}:${event.composed}`)
      );
    host.addEventListener(name, (event) =>
      outerEvents.push(`${event.type}:${event.composed}`)
    );
  }
  await createPage().locator("input").setInputFiles(payload());
  expect(events).toEqual(["input:true", "change:false"]);
  expect(outerEvents).toEqual(["input:true"]);
});

it("rejects malformed payloads and oversized buffers before encoding", () => {
  expect(() => inputFilePayloads({ ...payload(), mimeType: "" })).toThrow(
    "non-empty MIME type"
  );
  expect(() =>
    inputFilePayloads(payload("huge", new Uint8Array(50 * 1024 * 1024)))
  ).toThrow("less than 50Mb");
});
