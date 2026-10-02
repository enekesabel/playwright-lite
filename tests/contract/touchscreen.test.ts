import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "../../src/index";
import { emulateTouch } from "./touch";

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

describe("Touchscreen", () => {
  // Contract coverage: the pinned hasTouch test lives in
  // browsercontext-viewport.spec.ts, which the corpus cannot load.
  it("rejects without touch points, with Playwright's hasTouch error", async () => {
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const events: string[] = [];
    for (const type of ["pointerdown", "touchstart", "click"] as const)
      on(type, () => events.push(type));

    await expect(page.touchscreen.tap(20, 20)).rejects.toThrow(
      "touchscreen.tap: hasTouch must be enabled on the browser context before using the touchscreen."
    );
    expect(events).toEqual([]);
  });

  // Contract coverage: the pinned tap spec tracks the tapped element only,
  // without pointer capture events.
  it("captures the touched element with a new touch pointer each tap", async () => {
    emulateTouch();
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const log: string[] = [];
    for (const type of [
      "pointerdown",
      "gotpointercapture",
      "pointerup",
      "lostpointercapture",
      "click",
    ] as const)
      on(type, (event) => {
        const { pointerId, pointerType, width, pressure, isPrimary } = event;
        log.push(
          `${type}@${id(event.target)} ${pointerType}#${pointerId} ${width}/${pressure}/${isPrimary}`
        );
      });

    await page.touchscreen.tap(20, 20);
    await page.touchscreen.tap(20, 20);

    expect(log).toEqual([
      "pointerdown@a touch#2 2/1/true",
      "gotpointercapture@a touch#2 1/0/true",
      "pointerup@a touch#2 1/0/true",
      "lostpointercapture@a touch#2 1/0/true",
      "click@a touch#2 1/0/false",
      "pointerdown@a touch#3 2/1/true",
      "gotpointercapture@a touch#3 1/0/true",
      "pointerup@a touch#3 1/0/true",
      "lostpointercapture@a touch#3 1/0/true",
      "click@a touch#3 1/0/false",
    ]);
  });

  // Contract coverage: the pinned tap spec captures nothing explicitly. The
  // expected events are those Playwright's Chromium dispatches for the same
  // taps.
  it.each([
    [
      "moves",
      (event: PointerEvent) =>
        document.getElementById("b")!.setPointerCapture(event.pointerId),
      [
        "pointerover@a",
        "has:false,true",
        "pointerdown@a",
        "pointerout@a<b",
        "pointerover@b<a",
        "gotpointercapture@b",
        "pointerup@b",
        "lostpointercapture@b",
        "pointerout@b",
        "click@a",
      ],
    ],
    [
      "releases",
      (event: PointerEvent) =>
        document.getElementById("a")!.releasePointerCapture(event.pointerId),
      [
        "pointerover@a",
        "has:false,false",
        "pointerdown@a",
        "pointerup@a",
        "pointerout@a",
        "click@a",
      ],
    ],
  ] as const)(
    "lets a pointerdown listener that %s the touch point's capture choose where it lifts",
    async (_name, onPointerDown, expected) => {
      emulateTouch();
      document.body.innerHTML = box("a", 10, 10) + box("b", 110, 10);
      const log: string[] = [];
      document.getElementById("a")!.addEventListener("pointerdown", (event) => {
        onPointerDown(event);
        const has = ["a", "b"].map((name) =>
          document.getElementById(name)!.hasPointerCapture(event.pointerId)
        );
        log.push(`has:${has}`);
      });
      const page = createPage();
      for (const type of [
        "pointerdown",
        "pointerover",
        "pointerout",
        "gotpointercapture",
        "pointerup",
        "lostpointercapture",
        "click",
      ] as const)
        on(type, (event) => {
          const related = event.relatedTarget;
          log.push(
            `${type}@${id(event.target)}${related ? `<${id(related)}` : ""}`
          );
        });

      await page.touchscreen.tap(20, 20);

      expect(log).toEqual(expected);
    }
  );

  // Contract coverage: the pinned tap spec taps whole-pixel points only.
  it("sends the compatibility mouse events at the tap point rounded to whole pixels", async () => {
    emulateTouch();
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const points: string[] = [];
    for (const type of ["pointerdown", "touchstart", "mousedown"] as const)
      on(type, (event) => {
        const point = "touches" in event ? event.touches[0] : event;
        points.push(`${type} ${point.clientX},${point.clientY}`);
      });

    await page.touchscreen.tap(40.5, 60.25);

    expect(points).toEqual([
      "pointerdown 40.5,60.25",
      "touchstart 40.5,60.25",
      "mousedown 41,60",
    ]);
  });

  // Contract coverage: the pinned tap spec does not tap a focusable element.
  it("moves focus with the compatibility mousedown", async () => {
    emulateTouch();
    document.body.innerHTML = `<input id=input style="position: absolute; left: 10px; top: 10px; width: 80px; height: 30px">${box("plain", 110, 10)}`;
    const page = createPage();
    const focused = () => document.activeElement?.id || "body";
    const steps: string[] = [];

    await page.touchscreen.tap(20, 20);
    steps.push(focused());
    await page.touchscreen.tap(120, 20);
    steps.push(focused());

    expect(steps).toEqual(["input", "body"]);
  });

  // Contract coverage: the pinned tap spec cancels touch events only.
  it("withholds the compatibility mousemove, mousedown and mouseup after a canceled pointerdown", async () => {
    emulateTouch();
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    on("pointerdown", (event) => event.preventDefault());
    const log: string[] = [];
    for (const type of [
      "mouseover",
      "mousemove",
      "mousedown",
      "mouseup",
      "click",
    ] as const)
      on(type, () => log.push(type));

    await page.touchscreen.tap(20, 20);

    expect(log).toEqual(["mouseover", "click"]);
  });

  // Contract coverage: the pinned tap spec taps no disabled control.
  it("dispatches no compatibility mousedown, mouseup or click to a disabled form control", async () => {
    emulateTouch();
    document.body.innerHTML = `<button disabled style="position: absolute; left: 10px; top: 10px; width: 80px; height: 40px">no</button>`;
    const page = createPage();
    const log: string[] = [];
    for (const type of [
      "pointerdown",
      "touchstart",
      "mousemove",
      "mousedown",
      "mouseup",
      "click",
    ] as const)
      on(type, () => log.push(type));

    await page.touchscreen.tap(20, 20);

    expect(log).toEqual(["pointerdown", "touchstart", "mousemove"]);
  });

  // Contract coverage: the pinned tap spec never mixes the mouse with a tap.
  it("moves the mouse events' element under the pointer, but not the mouse's position or pointer events", async () => {
    emulateTouch();
    document.body.innerHTML = box("a", 10, 10) + box("b", 110, 10);
    const page = createPage();
    await page.mouse.move(20, 20);
    const log: string[] = [];
    for (const type of ["pointerover", "mouseover", "click"] as const)
      on(type, (event) =>
        log.push(
          `${type}@${id(event.target)}<${id(event.relatedTarget)} ${(event as PointerEvent).pointerType ?? ""}`
        )
      );

    await page.touchscreen.tap(120, 20);
    log.push("--");
    await page.mouse.down();
    await page.mouse.up();

    expect(log).toEqual([
      "pointerover@b< touch",
      "mouseover@b<a ",
      "click@b< touch",
      "--",
      "mouseover@a<b ",
      "click@a< mouse",
    ]);
  });

  // Contract coverage: a documented difference; Chromium counts quick taps
  // near each other as one multi-tap.
  it("sends each tap as a single tap", async () => {
    emulateTouch();
    document.body.innerHTML = box("a", 10, 10);
    const page = createPage();
    const log: string[] = [];
    for (const type of ["click", "dblclick"] as const)
      on(type, (event) => log.push(`${type}:${event.detail}`));

    await page.touchscreen.tap(20, 20);
    await page.touchscreen.tap(20, 20);

    expect(log).toEqual(["click:1", "click:1"]);
  });
});
