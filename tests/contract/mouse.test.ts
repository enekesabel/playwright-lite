import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";

let listeners = new AbortController();

afterEach(() => {
  listeners.abort();
  listeners = new AbortController();
  document.body.innerHTML = "";
  window.scrollTo(0, 0);
});

/**
 * Listens on the document for the events the adapter dispatches (the real
 * cursor can also move over the test frame) until the test ends.
 */
function on<K extends keyof DocumentEventMap>(
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options: AddEventListenerOptions = {}
) {
  document.addEventListener(
    type,
    (event) => {
      if (!event.isTrusted) listener(event);
    },
    { ...options, signal: listeners.signal }
  );
}

const id = (target: EventTarget | null) =>
  target instanceof Element ? target.id || target.localName : "";

/** Absolutely placed boxes, so every point below hits a known element. */
const box = (name: string, left: number, top: number) =>
  `<div id=${name} style="position: absolute; left: ${left}px; top: ${top}px; width: 80px; height: 80px"></div>`;

describe("Mouse", () => {
  // Contract coverage: the pinned page-mouse spec asserts enter/leave only
  // across an iframe, which is outside the current document.
  it("enters and leaves every flat-tree ancestor in Chromium's order", async () => {
    document.body.innerHTML = `<div id=outer style="position: absolute; left: 0; top: 0; width: 300px; height: 200px">${box("a", 10, 10)}${box("b", 110, 10)}</div>`;
    const page = createPage();
    await page.mouse.move(20, 20);
    const log: string[] = [];
    for (const kind of ["pointer", "mouse"])
      for (const type of ["out", "leave", "over", "enter"])
        on(
          `${kind}${type}` as "pointerover",
          (event) =>
            log.push(
              `${event.type}@${id(event.target)}<${id(event.relatedTarget)}`
            ),
          // Capture, so the document also sees enter and leave events.
          { capture: true }
        );

    await page.mouse.move(120, 20);
    await page.mouse.move(350, 20);

    expect(log).toEqual([
      "pointerout@a<b",
      "pointerleave@a<b",
      "pointerover@b<a",
      "pointerenter@b<a",
      "mouseout@a<b",
      "mouseleave@a<b",
      "mouseover@b<a",
      "mouseenter@b<a",
      "pointerout@b<body",
      "pointerleave@b<body",
      "pointerleave@outer<body",
      "pointerover@body<b",
      "mouseout@b<body",
      "mouseleave@b<body",
      "mouseleave@outer<body",
      "mouseover@body<b",
    ]);
  });

  // Contract coverage: the pinned click-generation tests also assert
  // isTrusted, which synthetic events never are.
  it("clicks the nearest common ancestor of the press and release targets", async () => {
    document.body.innerHTML = `<div id=parent>${box("a", 10, 10)}${box("b", 110, 10)}</div>`;
    const page = createPage();
    const log: string[] = [];
    for (const type of ["mousedown", "mouseup", "click"] as const)
      on(type, (event) => log.push(`${type}@${id(event.target)}`));

    await page.mouse.move(20, 20);
    await page.mouse.down();
    await page.mouse.move(120, 20);
    await page.mouse.up();

    expect(log).toEqual(["mousedown@a", "mouseup@b", "click@parent"]);
  });

  it("sends dblclick after the second click with detail 2", async () => {
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const details: string[] = [];
    for (const type of ["mousedown", "mouseup", "click", "dblclick"] as const)
      on(type, (event) => details.push(`${type}:${event.detail}`));

    await page.mouse.dblclick(20, 20);

    expect(details).toEqual([
      "mousedown:1",
      "mouseup:1",
      "click:1",
      "mousedown:2",
      "mouseup:2",
      "click:2",
      "dblclick:2",
    ]);
  });

  // Contract coverage: the pinned context-menu tests only await the event.
  it("sends contextmenu on a right press and auxclick on its release", async () => {
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const events: string[] = [];
    for (const type of [
      "mousedown",
      "contextmenu",
      "mouseup",
      "auxclick",
    ] as const)
      on(type, (event) => {
        event.preventDefault();
        const { button, buttons, detail } = event;
        events.push(`${type}:${button}/${buttons}/${detail}`);
      });

    await page.mouse.click(20, 20, { button: "right" });

    expect(events).toEqual([
      "mousedown:2/2/1",
      "contextmenu:2/2/0",
      "mouseup:2/0/1",
      "auxclick:2/0/1",
    ]);
  });

  it("withholds mousedown, mousemove and mouseup after a canceled pointerdown", async () => {
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    on("pointerdown", (event) => event.preventDefault());
    await page.mouse.move(20, 20);
    const log: string[] = [];
    for (const type of ["mousedown", "mousemove", "mouseup", "click"] as const)
      on(type, () => log.push(type));

    await page.mouse.down();
    await page.mouse.move(30, 30);
    await page.mouse.up();
    await page.mouse.move(40, 40);

    expect(log).toEqual(["click", "mousemove"]);
  });

  it("moves focus on press: to the nearest focusable ancestor, else away", async () => {
    document.body.innerHTML = `
      <input id=input style="position: absolute; left: 10px; top: 10px; width: 80px; height: 30px">
      <div id=card tabindex=0 style="position: absolute; left: 110px; top: 10px; width: 80px; height: 80px"><span>x</span></div>
      ${box("plain", 210, 10)}
      <label for=input style="position: absolute; left: 10px; top: 110px; width: 80px; height: 30px">L</label>
      <input id=guarded style="position: absolute; left: 110px; top: 110px; width: 80px; height: 30px">`;
    const page = createPage();
    on("mousedown", (event) => {
      if (id(event.target) === "guarded") event.preventDefault();
    });
    const focused = () => document.activeElement?.id || "body";
    const steps: string[] = [];

    await page.mouse.click(20, 20);
    steps.push(focused());
    await page.mouse.click(115, 15);
    steps.push(focused());
    await page.mouse.click(220, 20, { button: "right" });
    steps.push(focused());
    await page.mouse.click(20, 20, { button: "middle" });
    steps.push(focused());
    await page.mouse.click(120, 120);
    steps.push(focused());
    // A press on a label leaves focus alone; its click then focuses the control.
    await page.mouse.click(220, 20);
    await page.mouse.move(20, 120);
    await page.mouse.down();
    steps.push(focused());
    await page.mouse.up();
    steps.push(focused());

    expect(steps).toEqual([
      "input",
      "card",
      "body",
      "input",
      "input",
      "body",
      "input",
    ]);
  });

  it("dispatches no mousedown, mouseup or click to a disabled form control", async () => {
    document.body.innerHTML = `<button disabled style="position: absolute; left: 10px; top: 10px; width: 80px; height: 40px"><span>no</span></button>`;
    const page = createPage();
    const log: string[] = [];
    for (const type of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ] as const)
      on(type, () => log.push(type), { capture: true });

    await page.mouse.click(20, 20);

    expect(log).toEqual(["pointerdown", "pointerup"]);
  });

  // Contract coverage: the pinned wheel spec scrolls only the window.
  it("scrolls the nearest ancestor that can scroll in the wheel's direction", async () => {
    document.body.innerHTML = `
      <div id=outer style="position: absolute; left: 0; top: 0; width: 200px; height: 200px; overflow: auto">
        <div id=inner style="width: 150px; height: 150px; overflow: auto"><div style="width: 100px; height: 400px"></div></div>
        <div style="height: 1000px"></div>
      </div>`;
    const page = createPage();
    const outer = document.getElementById("outer")!;
    const inner = document.getElementById("inner")!;

    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 100);
    expect([inner.scrollTop, outer.scrollTop]).toEqual([100, 0]);

    await page.mouse.wheel(40, 0);
    expect([inner.scrollLeft, outer.scrollLeft]).toEqual([0, 0]);

    inner.style.overflow = "hidden";
    await page.mouse.wheel(0, 100);
    expect([inner.scrollTop, outer.scrollTop]).toEqual([100, 100]);
  });

  it("reports wheelDelta against the delta's direction", async () => {
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const deltas: number[][] = [];
    on(
      "wheel",
      (event) => {
        event.preventDefault();
        const legacy = event as WheelEvent & {
          wheelDeltaX: number;
          wheelDeltaY: number;
          wheelDelta: number;
        };
        deltas.push([
          legacy.wheelDeltaX,
          legacy.wheelDeltaY,
          legacy.wheelDelta,
        ]);
      },
      { passive: false }
    );

    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 30);
    await page.mouse.wheel(-250, 0);

    expect(deltas).toEqual([
      [0, -120, -120],
      [120, 0, 120],
    ]);
  });

  it("shares its position and held buttons with the pointer actions", async () => {
    document.body.innerHTML = box("a", 10, 10) + box("b", 110, 10);
    const page = createPage();
    const log: string[] = [];
    on("mousedown", (event) =>
      log.push(`${id(event.target)}:${event.buttons}`)
    );

    await page.hover("#b");
    await page.mouse.down({ button: "middle" });
    await page.click("#a");
    await page.mouse.up({ button: "middle" });

    expect(log).toEqual(["b:4", "a:5"]);
  });

  // Contract coverage: no pinned spec sets a default timeout around the mouse.
  it("ignores the default action timeout, as Playwright sends it no timeout", async () => {
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    page.setDefaultTimeout(1);
    let clicks = 0;
    on("click", () => clicks++);

    await page.mouse.click(20, 20, { delay: 20 });

    expect(clicks).toBe(1);
  });
});
