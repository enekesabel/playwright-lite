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

  // Contract coverage: the pinned dblclick test also asserts isTrusted.
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

  // Contract coverage: no pinned spec cancels a pointerdown.
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

  // Contract coverage: no pinned spec asserts where a press moves focus.
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

  // Contract coverage: no pinned spec presses inside a scroll container.
  it("does not focus a scroll container a press lands in", async () => {
    document.body.innerHTML = `
      <input id=input style="position: absolute; left: 10px; top: 10px; width: 80px; height: 30px">
      <div id=scroller style="position: absolute; left: 110px; top: 10px; width: 80px; height: 80px; overflow: auto"><p style="margin: 0; height: 400px">text</p></div>`;
    const page = createPage();
    const scroller = document.getElementById("scroller")!;
    const focused = () => document.activeElement?.id || "body";
    const steps: (string | number)[] = [];

    await page.mouse.click(20, 20);
    steps.push(focused());
    await page.mouse.click(120, 15);
    steps.push(focused(), scroller.tabIndex);
    await page.click("#scroller p");
    steps.push(focused());

    expect(steps).toEqual(["input", "body", -1, "body"]);
  });

  // Contract coverage: no pinned spec changes the element under a still
  // pointer before a press.
  it("gives the boundary events a press brings the pressed button", async () => {
    document.body.innerHTML = box("a", 10, 10) + box("under", 10, 10);
    const page = createPage();
    const top = document.getElementById("under")!;
    on("contextmenu", (event) => event.preventDefault());
    await page.mouse.move(20, 20);
    top.style.display = "none";
    const log: string[] = [];
    for (const type of ["pointerover", "mouseover"] as const)
      on(type, (event) => {
        const pointer = event as PointerEvent;
        log.push(
          type === "pointerover"
            ? `${type}@${id(event.target)} ${pointer.button}/${pointer.buttons}/${pointer.pressure}`
            : `${type}@${id(event.target)} ${event.buttons}/${event.which}`
        );
      });

    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });

    expect(log).toEqual(["pointerover@a 2/2/0.5", "mouseover@a 2/3"]);
  });

  // Contract coverage: the pinned disabled-button test asserts only :hover.
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

  // Contract coverage: no pinned spec reads the legacy wheelDelta fields.
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

  // Contract coverage: no pinned spec holds a button across a Page action.
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

  // Contract coverage: a documented difference, since Chromium waits for a
  // few pixels of movement; the pinned drag tests record no pointer events.
  it("starts a drag on the first move with the left button held, canceling the pointer until the drop", async () => {
    document.body.innerHTML =
      box("a", 10, 10).replace("<div", "<div draggable=true") +
      box("b", 110, 10);
    document
      .getElementById("b")!
      .addEventListener("dragover", (event) => event.preventDefault());
    const page = createPage();
    await page.mouse.move(20, 20);
    await page.mouse.down();
    const log: string[] = [];
    for (const type of [
      "pointercancel",
      "pointerout",
      "pointerover",
      "pointermove",
      "mousemove",
      "dragstart",
      "dragenter",
      "drop",
      "dragend",
    ] as const)
      on(type, (event) =>
        log.push(
          `${type}@${id(event.target)} ${event.clientX},${event.clientY}`
        )
      );

    await page.mouse.move(21, 20);
    await page.mouse.move(120, 20);
    await page.mouse.up();
    await page.mouse.move(125, 20);

    expect(log).toEqual([
      "pointermove@a 21,20",
      "mousemove@a 21,20",
      "dragstart@a 20,20",
      "pointercancel@a 0,0",
      "pointerout@a 0,0",
      "dragenter@a 21,20",
      "dragenter@b 120,20",
      "drop@b 120,20",
      "dragend@a 120,20",
      "pointerover@b 125,20",
      "pointermove@b 125,20",
      "mousemove@b 125,20",
    ]);
  });

  // Contract coverage: the pinned drag tests press and release the left
  // button only.
  it("ignores presses during a drag, drops on any release, and then clicks nothing", async () => {
    document.body.innerHTML =
      box("a", 10, 10).replace("<div", "<div draggable=true") +
      box("b", 110, 10);
    document
      .getElementById("b")!
      .addEventListener("dragover", (event) => event.preventDefault());
    const page = createPage();
    await page.mouse.move(20, 20);
    await page.mouse.down();
    const log: string[] = [];
    for (const type of [
      "pointerdown",
      "mousedown",
      "contextmenu",
      "pointerup",
      "mouseup",
      "click",
      "auxclick",
      "drop",
      "dragend",
    ] as const)
      on(type, (event) =>
        log.push(`${type}@${id(event.target)} ${event.detail}`)
      );

    await page.mouse.move(120, 20);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.mouse.up();

    expect(log).toEqual([
      "drop@b 0",
      "dragend@a 0",
      "pointerup@b 0",
      "mouseup@b 0",
    ]);
  });

  // Contract coverage: the pinned drag tests start every drag with an
  // uncanceled single left press.
  it.each([
    ["a canceled mousedown", { button: "left", clickCount: 1 }, true],
    ["a double-click press", { button: "left", clickCount: 2 }, false],
    ["the right button", { button: "right", clickCount: 1 }, false],
  ] as const)(
    "starts no drag after %s",
    async (_name, press, cancelMousedown) => {
      document.body.innerHTML =
        box("a", 10, 10).replace("<div", "<div draggable=true") +
        box("b", 110, 10);
      if (cancelMousedown) on("mousedown", (event) => event.preventDefault());
      const page = createPage();
      const log: string[] = [];
      for (const type of ["dragstart", "mousemove", "mouseup"] as const)
        on(type, (event) => log.push(`${type}@${id(event.target)}`));

      await page.mouse.move(20, 20);
      await page.mouse.down(press);
      await page.mouse.move(120, 20);
      await page.mouse.up(press);

      expect(log).toEqual(["mousemove@a", "mousemove@b", "mouseup@b"]);
    }
  );

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

  /** Each event of `types` as `type@target`, with `<relatedTarget>` when it has one. */
  function record(types: readonly (keyof DocumentEventMap)[]) {
    const log: string[] = [];
    for (const type of types)
      on(type, (event) => {
        const related = (event as MouseEvent).relatedTarget;
        log.push(
          `${type}@${event.target === document ? "document" : id(event.target)}${related ? `<${id(related)}` : ""}`
        );
      });
    return log;
  }

  const CAPTURE_EVENTS = [
    "pointerover",
    "pointerout",
    "gotpointercapture",
    "lostpointercapture",
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "mouseover",
    "mouseout",
    "mousedown",
    "mousemove",
    "mouseup",
    "click",
    "auxclick",
    "contextmenu",
  ] as const;

  /** A handle at (10, 10) that captures the pointer that presses it. */
  function captureOnPress(target = "h") {
    const handle = document.getElementById("h")!;
    handle.addEventListener("pointerdown", (event) =>
      document.getElementById(target)!.setPointerCapture(event.pointerId)
    );
    return handle;
  }

  // Contract coverage: no pinned test captures the pointer. The expected
  // events are those Playwright's Chromium dispatches for the same input.
  it("sends a captured mouse's events to the capture target, then enters the element under it after the release", async () => {
    document.body.innerHTML = box("h", 10, 10) + box("t", 200, 10);
    const handle = captureOnPress();
    const has: boolean[] = [];
    on("pointerdown", (event) =>
      has.push(handle.hasPointerCapture(event.pointerId))
    );
    on("lostpointercapture", () => has.push(handle.hasPointerCapture(1)));
    const page = createPage();
    await page.mouse.move(30, 30);
    const log = record(CAPTURE_EVENTS);

    await page.mouse.down();
    await page.mouse.move(230, 30, { steps: 2 });
    await page.mouse.up();

    expect(has).toEqual([true, false]);
    expect(log).toEqual([
      "pointerdown@h",
      "mousedown@h",
      "gotpointercapture@h",
      "pointermove@h",
      "mousemove@h",
      "pointermove@h",
      "mousemove@h",
      "pointerup@h",
      "mouseup@h",
      "lostpointercapture@h",
      "click@h",
      "pointerout@h<t",
      "pointerover@t<h",
      "mouseout@h<t",
      "mouseover@t<h",
    ]);
  });

  // Contract coverage: as above; Playwright's Chromium leaves the handle at
  // 260px.
  it("moves a handle that captures the pointer in several steps past its own box", async () => {
    document.body.innerHTML = box("h", 10, 10) + box("t", 200, 10);
    const handle = document.getElementById("h")!;
    let offset = 0;
    handle.addEventListener("pointerdown", (event) => {
      handle.setPointerCapture(event.pointerId);
      offset = event.clientX - handle.offsetLeft;
    });
    handle.addEventListener("pointermove", (event) => {
      if (handle.hasPointerCapture(event.pointerId))
        handle.style.left = `${event.clientX - offset}px`;
    });
    const page = createPage();

    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(300, 60, { steps: 5 });
    await page.mouse.up();

    expect(handle.style.left).toBe("260px");
  });

  // Contract coverage: as above.
  it("moves capture to another element: the pointer enters it, gains capture there, and clicks it", async () => {
    document.body.innerHTML =
      box("h", 10, 10) + box("o", 100, 10) + box("t", 200, 10);
    captureOnPress("o");
    const page = createPage();
    await page.mouse.move(30, 30);
    const log = record(CAPTURE_EVENTS);

    await page.mouse.down();
    await page.mouse.up();

    expect(log).toEqual([
      "pointerdown@h",
      "mousedown@h",
      "pointerout@h<o",
      "pointerover@o<h",
      "gotpointercapture@o",
      "mouseout@h<o",
      "mouseover@o<h",
      "pointerup@o",
      "mouseup@o",
      "lostpointercapture@o",
      "click@o",
      "pointerout@o<h",
      "pointerover@h<o",
      "mouseout@o<h",
      "mouseover@h<o",
    ]);
  });

  // Contract coverage: as above.
  it("loses capture before the next event once released, leaving the mouse event with the capture target", async () => {
    document.body.innerHTML = box("h", 10, 10) + box("t", 200, 10);
    const handle = captureOnPress();
    handle.addEventListener("pointermove", (event) => {
      if (event.buttons) handle.releasePointerCapture(event.pointerId);
    });
    const page = createPage();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    const log = record(CAPTURE_EVENTS);

    await page.mouse.move(150, 30);
    await page.mouse.move(230, 30);
    const captured = handle.hasPointerCapture(1);
    await page.mouse.up();

    expect(captured).toBe(false);
    expect(log).toEqual([
      "gotpointercapture@h",
      "pointermove@h",
      "mousemove@h",
      "lostpointercapture@h",
      "pointerout@h<t",
      "pointerover@t<h",
      "mouseout@h<t",
      "mouseover@t<h",
      "pointermove@t",
      "mousemove@t",
      "pointerup@t",
      "mouseup@t",
      "click@body",
    ]);
  });

  // Contract coverage: as above.
  it("loses capture at the document once the capture target leaves it", async () => {
    document.body.innerHTML = `<div id=w>${box("h", 10, 10)}</div>${box("t", 200, 10)}`;
    const handle = captureOnPress();
    const page = createPage();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(150, 30);
    const log = record(CAPTURE_EVENTS);
    handle.addEventListener("pointermove", () => handle.remove());

    await page.mouse.move(160, 30);
    const captured = handle.hasPointerCapture(1);
    await page.mouse.move(230, 30);
    await page.mouse.up();

    expect(captured).toBe(false);
    expect(log).toEqual([
      "pointermove@h",
      // The removed handle's mouse event goes to its old parent.
      "mousemove@w",
      "lostpointercapture@document",
      "pointerover@t<h",
      "mouseover@t<h",
      "pointermove@t",
      "mousemove@t",
      "pointerup@t",
      "mouseup@t",
    ]);
  });

  // Contract coverage: as above. Playwright's Chromium also dispatches no
  // click after the press target left the document, which the log stops
  // before.
  it("loses capture when the capture target leaves the document, even if it is added back before the next event", async () => {
    document.body.innerHTML = `<div id=w>${box("h", 10, 10)}</div>${box("t", 200, 10)}`;
    const handle = captureOnPress();
    const page = createPage();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(230, 30);
    const log = record(CAPTURE_EVENTS);

    const wrapper = document.getElementById("w")!;
    wrapper.remove();
    document.body.prepend(wrapper);
    const captured = handle.hasPointerCapture(1);
    await page.mouse.move(240, 40);
    const events = [...log];
    await page.mouse.up();

    expect(captured).toBe(false);
    expect(events).toEqual([
      "lostpointercapture@h",
      "pointerout@h<t",
      "pointerover@t<h",
      "mouseout@h<t",
      "mouseover@t<h",
      "pointermove@t",
      "mousemove@t",
    ]);
  });

  // Contract coverage: as above.
  it("loses capture when a shadow host around the capture target leaves the document", async () => {
    document.body.innerHTML = `<div id=w></div>${box("t", 200, 10)}`;
    const host = document.getElementById("w")!;
    host.attachShadow({ mode: "open" }).innerHTML = box("h", 10, 10);
    const handle = host.shadowRoot!.getElementById("h")!;
    handle.addEventListener("pointerdown", (event) =>
      handle.setPointerCapture(event.pointerId)
    );
    const page = createPage();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(230, 30);
    const log = record(["lostpointercapture", "pointermove"]);

    host.remove();
    document.body.prepend(host);
    const captured = handle.hasPointerCapture(1);
    await page.mouse.move(240, 40);
    const events = [...log];
    await page.mouse.up();

    expect(captured).toBe(false);
    expect(events).toEqual(["lostpointercapture@w", "pointermove@t"]);
  });

  // Contract coverage: as above.
  it("keeps capture through a chorded press, and loses it with the next event after any release", async () => {
    document.body.innerHTML = box("h", 10, 10) + box("t", 200, 10);
    captureOnPress();
    const page = createPage();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(230, 30);
    const log = record(CAPTURE_EVENTS);

    await page.mouse.down({ button: "right" });
    await page.mouse.up();
    await page.mouse.move(240, 30);
    await page.mouse.up({ button: "right" });

    expect(log).toEqual([
      "pointermove@h",
      "mousedown@h",
      "contextmenu@h",
      "pointermove@h",
      "mouseup@h",
      "click@h",
      "lostpointercapture@h",
      "pointerout@h<t",
      "pointerover@t<h",
      "mouseout@h<t",
      "mouseover@t<h",
      "pointermove@t",
      "mousemove@t",
      "pointerup@t",
      "mouseup@t",
    ]);
  });

  // Contract coverage: as above.
  it("cancels a captured pointer at its capture target when an HTML drag starts", async () => {
    document.body.innerHTML =
      box("h", 10, 10).replace("<div", "<div draggable=true") +
      box("t", 200, 10);
    captureOnPress();
    const page = createPage();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    const log = record([...CAPTURE_EVENTS, "dragstart"]);

    await page.mouse.move(150, 30);
    const events = log.splice(0);
    await page.keyboard.press("Escape");
    await page.mouse.up();

    expect(events).toEqual([
      "gotpointercapture@h",
      "pointermove@h",
      "mousemove@h",
      "dragstart@h",
      "pointercancel@h",
      "lostpointercapture@h",
    ]);
  });

  // Contract coverage: as above.
  it("ignores setPointerCapture while no button is held, and keeps the browser's own errors", async () => {
    document.body.innerHTML = box("h", 10, 10) + box("t", 200, 10);
    const handle = document.getElementById("h")!;
    const results: string[] = [];
    const attempt = (run: () => unknown) => {
      try {
        results.push(String(run()));
      } catch (error) {
        results.push((error as DOMException).name);
      }
    };
    handle.addEventListener("pointermove", (event) =>
      attempt(() => handle.setPointerCapture(event.pointerId))
    );
    handle.addEventListener("pointerdown", (event) => {
      attempt(() => handle.setPointerCapture(7));
      attempt(() =>
        document.createElement("div").setPointerCapture(event.pointerId)
      );
      attempt(() => handle.setPointerCapture(event.pointerId));
      attempt(() => handle.hasPointerCapture(event.pointerId));
    });
    const page = createPage();
    const log = record(["gotpointercapture", "pointermove"]);

    await page.mouse.move(30, 30);
    await page.mouse.move(230, 30);
    await page.mouse.move(30, 30);
    log.push("down");
    await page.mouse.down();
    await page.mouse.up();

    expect(results).toEqual([
      "undefined",
      "undefined",
      "NotFoundError",
      "InvalidStateError",
      "undefined",
      "true",
    ]);
    expect(log).toEqual([
      "pointermove@h",
      "pointermove@t",
      "pointermove@h",
      "down",
      "gotpointercapture@h",
    ]);
  });

  // Contract coverage: as above.
  it("converts the pointer id once, as the browser does", async () => {
    document.body.innerHTML = box("h", 10, 10);
    const handle = document.getElementById("h")!;
    let next = 1;
    let conversions = 0;
    const has: boolean[] = [];
    handle.addEventListener("pointerdown", () => {
      handle.setPointerCapture({
        valueOf: () => (conversions++, next++),
      } as unknown as number);
      has.push(handle.hasPointerCapture(1));
    });
    const page = createPage();

    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.up();

    expect({ conversions, has }).toEqual({ conversions: 1, has: [true] });
  });

  // Contract coverage: an adapter-specific boundary, since a Playwright
  // release is one browser input that a timeout cannot split.
  it("ends capture when a release is interrupted before its last button loses it", async () => {
    document.body.innerHTML = box("h", 10, 10) + box("t", 200, 10);
    const handle = captureOnPress();
    handle.addEventListener("pointerup", () => {
      const end = performance.now() + 300;
      while (performance.now() < end);
    });
    const original = Element.prototype.setPointerCapture;
    const page = createPage();
    await page.mouse.move(30, 30);

    await expect(page.locator("#h").click({ timeout: 150 })).rejects.toThrow(
      /Timeout 150ms exceeded/
    );
    const log = record(["pointermove"]);
    await page.mouse.move(230, 30);

    expect(log).toEqual(["pointermove@t"]);
    expect(handle.hasPointerCapture(1)).toBe(false);
    expect(Element.prototype.setPointerCapture).toBe(original);
  });

  // Contract coverage: an adapter-specific boundary; Playwright replaces no
  // page function.
  it("wraps the capture members only while a button is held or capture remains", async () => {
    document.body.innerHTML = box("h", 10, 10);
    captureOnPress();
    const original = Element.prototype.setPointerCapture;
    const page = createPage();
    await page.mouse.move(30, 30);

    await page.mouse.down();
    const held = Element.prototype.setPointerCapture;
    await page.mouse.up();
    const released = Element.prototype.setPointerCapture;
    await page.mouse.down();
    await page.close();

    expect(held).not.toBe(original);
    expect(released).toBe(original);
    expect(Element.prototype.setPointerCapture).toBe(original);
  });
});
