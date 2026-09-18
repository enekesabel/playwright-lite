import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

type DropInfo = {
  files: { name: string; type: string; text: string }[];
  data: Record<string, string>;
  events: string[];
  point: { x: number; y: number };
};

function payload(name: string, text: string) {
  return {
    name,
    mimeType: "text/plain",
    buffer: new TextEncoder().encode(text) as unknown as Buffer,
  };
}

/** A drop target that records the sequence it observes. */
function setupDropzone({ accept = true } = {}) {
  document.body.innerHTML =
    '<div id="dropzone" style="width: 300px; height: 200px;"></div>';
  const zone = document.querySelector("#dropzone")!;
  const info: DropInfo = {
    files: [],
    data: {},
    events: [],
    point: { x: 0, y: 0 },
  };
  const pending: Promise<void>[] = [];
  for (const type of ["dragenter", "dragover", "dragleave", "drop"])
    zone.addEventListener(type, (event) => {
      const drag = event as DragEvent;
      info.events.push(type);
      info.point = { x: drag.clientX, y: drag.clientY };
      if (accept && type !== "dragleave") event.preventDefault();
      if (type !== "drop") return;
      for (const file of Array.from(drag.dataTransfer!.files))
        pending.push(
          file
            .text()
            .then(
              (text) =>
                void info.files.push({ name: file.name, type: file.type, text })
            )
        );
      for (const mimeType of Array.from(drag.dataTransfer!.types))
        if (mimeType !== "Files")
          info.data[mimeType] = drag.dataTransfer!.getData(mimeType);
    });
  return async () => {
    await Promise.all(pending);
    return info;
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Locator.drop", () => {
  it("dispatches the drag sequence with file payloads at the element center", async () => {
    const read = setupDropzone();
    const page = createPage();
    await page.locator("#dropzone").drop({
      files: [payload("a.txt", "AAA"), payload("b.txt", "BB")],
    });
    const info = await read();
    expect(info.events).toEqual(["dragenter", "dragover", "drop"]);
    expect(info.files).toEqual([
      { name: "a.txt", type: "text/plain", text: "AAA" },
      { name: "b.txt", type: "text/plain", text: "BB" },
    ]);
    const box = document.querySelector("#dropzone")!.getBoundingClientRect();
    expect(info.point).toEqual({
      x: Math.round(box.left + box.width / 2),
      y: Math.round(box.top + box.height / 2),
    });
  });

  it("carries clipboard-like data entries alongside files", async () => {
    const read = setupDropzone();
    const page = createPage();
    await page.locator("#dropzone").drop({
      files: payload("mix.txt", "mix"),
      data: { "text/plain": "label", "text/uri-list": "https://example.com" },
    });
    const info = await read();
    expect(info.files.map((file) => file.text)).toEqual(["mix"]);
    expect(info.data).toEqual({
      "text/plain": "label",
      "text/uri-list": "https://example.com",
    });
  });

  it("dispatches dragleave and throws when the target rejects the drop", async () => {
    const read = setupDropzone({ accept: false });
    const page = createPage();
    await expect(
      page.locator("#dropzone").drop({ data: { "text/plain": "nope" } })
    ).rejects.toThrow(/drop target did not accept the drop/i);
    const info = await read();
    expect(info.events).toEqual(["dragenter", "dragover", "dragleave"]);
  });

  it("requires files or data", async () => {
    setupDropzone();
    const page = createPage();
    for (const invalid of [{}, { files: [] }, { data: {} }])
      await expect(page.locator("#dropzone").drop(invalid)).rejects.toThrow(
        'At least one of "files" or "data" must be provided.'
      );
  });

  it("rejects file paths, which need the filesystem", async () => {
    setupDropzone();
    const page = createPage();
    await expect(
      page.locator("#dropzone").drop({ files: "tests/assets/one-style.css" })
    ).rejects.toThrow("drop: file paths are not supported");
  });

  it("waits for the target and reports its own timeout", async () => {
    const page = createPage();
    await expect(
      page
        .locator("#dropzone")
        .drop({ data: { "text/plain": "x" } }, { timeout: 30 })
    ).rejects.toThrow("Timeout 30ms exceeded");
    const pending = page
      .locator("#dropzone")
      .drop({ data: { "text/plain": "x" } }, { timeout: 2000 });
    const read = setupDropzone();
    await pending;
    expect((await read()).data).toEqual({ "text/plain": "x" });
  });
});
