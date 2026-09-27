import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

let listeners = new AbortController();

afterEach(() => {
  listeners.abort();
  listeners = new AbortController();
  document.body.innerHTML = "";
});

/** Absolutely placed boxes, so every drag below hits a known element. */
const box = (name: string, left: number, attributes = "") =>
  `<div id=${name} ${attributes} style="position: absolute; left: ${left}px; top: 10px; width: 80px; height: 80px"></div>`;

const DRAG_EVENTS = [
  "dragstart",
  "drag",
  "dragenter",
  "dragover",
  "dragleave",
  "drop",
  "dragend",
] as const;

/**
 * Each adapter-dispatched event of `types` on the document, as
 * `type@id`, followed by what `details` adds, until the test ends.
 */
function record(
  types: readonly string[],
  details: (event: DragEvent) => string = () => ""
) {
  const log: string[] = [];
  for (const type of types)
    document.addEventListener(
      type,
      (event) => {
        if (event.isTrusted) return;
        const detail = details(event as DragEvent);
        log.push(
          `${type}@${(event.target as Element).id}${detail ? ` ${detail}` : ""}`
        );
      },
      { capture: true, signal: listeners.signal }
    );
  return log;
}

/** Makes `id` accept a drop, running `onDragOver` in its `dragover`. */
function accept(id: string, onDragOver: (event: DragEvent) => void = () => {}) {
  const target = document.getElementById(id)!;
  target.addEventListener("dragover", (event) => {
    event.preventDefault();
    onDragOver(event);
  });
  target.addEventListener("drop", (event) => event.preventDefault());
}

const effects = (event: DragEvent) =>
  `${event.dataTransfer!.effectAllowed}/${event.dataTransfer!.dropEffect}`;

describe("Locator.dragTo", () => {
  // Contract coverage: the pinned drop-effect test sets dropEffect in every
  // dragover; these are the operations Chromium chooses when none is set.
  it.each([
    ["uninitialized", "copy"],
    ["copyMove", "move"],
    ["linkMove", "move"],
    ["copyLink", "copy"],
    ["none", "none"],
  ])(
    "reads the effects Chromium reports when the source allows %s and no dragover sets one",
    async (effectAllowed, operation) => {
      document.body.innerHTML =
        box("src", 10, "draggable=true") + box("t", 150);
      accept("t");
      document.getElementById("src")!.addEventListener("dragstart", (event) => {
        if (effectAllowed !== "uninitialized")
          event.dataTransfer!.effectAllowed = effectAllowed as "all";
      });
      const log = record(
        ["dragstart", "dragenter", "drop", "dragend"],
        effects
      );
      const page = createPage();

      await page.locator("#src").dragTo(page.locator("#t"));

      const target = effectAllowed === "uninitialized" ? "all" : effectAllowed;
      expect(log).toEqual([
        "dragstart@src uninitialized/none",
        `dragenter@t ${target}/${operation}`,
        ...(operation === "none" ? [] : [`drop@t ${target}/${operation}`]),
        `dragend@src ${effectAllowed}/${operation}`,
      ]);
    }
  );

  // Contract coverage: no pinned test writes the effects outside the events
  // Chromium lets change them.
  it("keeps effectAllowed from dragstart and ignores a dropEffect Chromium does not know", async () => {
    document.body.innerHTML = box("src", 10, "draggable=true") + box("t", 150);
    const seen: string[] = [];
    accept("t", (event) => {
      event.dataTransfer!.effectAllowed = "link";
      event.dataTransfer!.dropEffect = "bogus" as "copy";
      seen.push(effects(event));
      event.dataTransfer!.dropEffect = "move";
    });
    document
      .getElementById("src")!
      .addEventListener(
        "dragstart",
        (event) => (event.dataTransfer!.effectAllowed = "move")
      );
    const log = record(["drop", "dragend"], effects);
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#t"));

    expect(seen).toEqual(["move/move"]);
    expect(log).toEqual(["drop@t move/move", "dragend@src move/move"]);
  });

  // Contract coverage: the pinned tests assert only whether a refused drop
  // happened, not the events that end it.
  it("ends a drop no dragover accepts with drag, dragleave and dragend", async () => {
    document.body.innerHTML = box("src", 10, "draggable=true") + box("t", 150);
    const log = record(DRAG_EVENTS, effects);
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#t"));

    expect(log).toEqual([
      "dragstart@src uninitialized/none",
      "drag@src uninitialized/none",
      "dragenter@t all/copy",
      "dragover@t all/copy",
      "drag@src uninitialized/none",
      "dragleave@t all/none",
      "dragend@src uninitialized/none",
    ]);
  });

  // Contract coverage: the pinned tweened-drag tests drag no draggable
  // element, and no pinned test drags across targets.
  it("fires drag on the source before each new target, and every other dragover over the same one", async () => {
    document.body.innerHTML =
      box("src", 10, "draggable=true") + box("a", 110) + box("b", 190);
    accept("b");
    const log = record(DRAG_EVENTS, (event) =>
      event.type === "dragenter" || event.type === "dragleave"
        ? `<${(event.relatedTarget as Element | null)?.id ?? ""} ${event.clientX}`
        : `${event.clientX}`
    );
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#b"), {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 70, y: 10 },
      steps: 4,
    });

    expect(log).toEqual([
      "dragstart@src 20",
      "drag@src 80",
      "dragenter@src < 80",
      "drag@src 140",
      "dragenter@a <src 140",
      "dragleave@src <a 140",
      "drag@src 200",
      "dragenter@b <a 200",
      "dragleave@a <b 200",
      "dragover@b 260",
      "drag@src 260",
      "dragover@b 260",
      "drop@b 260",
      "dragend@src 260",
    ]);
  });

  // Contract coverage: a documented difference; Chromium protects the data
  // outside dragstart and drop.
  it("reads and writes the data in every drag event", async () => {
    document.body.innerHTML = box("src", 10, "draggable=true") + box("t", 150);
    accept("t", (event) =>
      event.dataTransfer!.setData("late", "set in dragover")
    );
    document
      .getElementById("src")!
      .addEventListener("dragstart", (event) =>
        event.dataTransfer!.setData("text/plain", "payload")
      );
    const log = record(
      ["dragenter", "dragover", "drop", "dragend"],
      (event) =>
        `${event.dataTransfer!.getData("text/plain")},${event.dataTransfer!.getData("late")}`
    );
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#t"));

    expect(log).toEqual([
      "dragenter@t payload,",
      "dragover@t payload,",
      "drop@t payload,set in dragover",
      "dragend@src payload,set in dragover",
    ]);
  });

  // Contract coverage: a documented difference; the browser's default drop
  // handling accepts a drop on an editable element and inserts the text.
  it("drops nothing on an editable element whose dragover is not canceled", async () => {
    document.body.innerHTML =
      box("src", 10, "draggable=true") +
      '<input id=field style="position: absolute; left: 150px; top: 10px; width: 80px">';
    document
      .getElementById("src")!
      .addEventListener("dragstart", (event) =>
        event.dataTransfer!.setData("text/plain", "payload")
      );
    const log = record(["drop", "dragleave"]);
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#field"));

    expect(log).toEqual(["dragleave@field"]);
    expect(document.querySelector("input")!.value).toBe("");
  });

  // Contract coverage: a documented difference; the browser adds a dragged
  // link's URL to the data.
  it("drags a link with no data unless dragstart sets it", async () => {
    document.body.innerHTML =
      '<a id=link href="#dragged" style="position: absolute; left: 10px; top: 10px; font-size: 40px">link</a>' +
      box("t", 150);
    accept("t");
    const log = record(["drop"], (event) =>
      JSON.stringify(Array.from(event.dataTransfer!.types))
    );
    const page = createPage();

    await page.locator("#link").dragTo(page.locator("#t"));

    expect(log).toEqual(["drop@t []"]);
  });

  // Contract coverage: no pinned drag test runs a trial.
  it("drags nothing in a trial run, whose press the page does not see", async () => {
    document.body.innerHTML = box("src", 10, "draggable=true") + box("t", 150);
    accept("t");
    const log = record([...DRAG_EVENTS, "mousedown", "mouseup"]);
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#t"), { trial: true });

    expect(log).toEqual([]);
  });

  // Contract coverage: no pinned drag test covers its target.
  it("retries while another element receives the drop point, and drops through it with force", async () => {
    document.body.innerHTML =
      box("src", 10, "draggable=true") +
      box("t", 150) +
      '<div id=cover style="position: absolute; left: 140px; top: 0; width: 120px; height: 120px"></div>';
    accept("cover");
    const log = record(["dragstart", "drop"]);
    const page = createPage();

    await page.locator("#src").dragTo(page.locator("#t"), {
      force: true,
      targetPosition: { x: 40, y: 40 },
    });
    await expect(
      page.locator("#src").dragTo(page.locator("#t"), { timeout: 300 })
    ).rejects.toThrow(
      /locator\.dragTo: Timeout 300ms exceeded\..*<div id="cover"><\/div> intercepts pointer events/s
    );

    expect(log).toEqual(["dragstart@src", "drop@cover"]);
  });

  // Contract coverage: no pinned drag test times out.
  it("logs the source's steps before the target's when it times out", async () => {
    document.body.innerHTML = box("src", 10);
    const page = createPage();

    const error: Error = await page
      .locator("#src")
      .dragTo(page.locator("#missing"), { timeout: 300 })
      .catch((error) => error);

    expect(error.message).toMatch(
      /^locator\.dragTo: Timeout 300ms exceeded\.[^]*\n {2}- waiting for locator\('#src'\)\n[^]*\n {4}- performing move and down action\n[^]*\n {2}- waiting for locator\('#missing'\)$/
    );
  });

  // Contract coverage: this package's error for a target that is no locator.
  it("rejects a target that is not a locator", async () => {
    document.body.innerHTML = box("src", 10, "draggable=true");
    const page = createPage();

    await expect(page.locator("#src").dragTo("#t" as never)).rejects.toThrow(
      "locator.dragTo: target: expected an PlaywrightLite Locator, got string"
    );
  });
});
