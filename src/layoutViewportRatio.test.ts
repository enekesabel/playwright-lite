import { afterEach, describe, expect, it } from "vitest";

import { layoutViewportRatio } from "./layoutViewportRatio";

afterEach(() => {
  document.body.innerHTML = "";
  scrollTo(0, 0);
});

/** The ratio a real IntersectionObserver reports, as pinned `viewportRatio` reads it. */
function observedRatio(element: Element): Promise<number> {
  return new Promise((resolve) => {
    const observer = new IntersectionObserver(([entry]) => {
      observer.disconnect();
      resolve(entry!.intersectionRatio);
    });
    observer.observe(element);
  });
}

const layouts: [name: string, html: string][] = [
  ["fully inside", '<div id="target" style="width:50px;height:50px"></div>'],
  [
    "below the viewport",
    '<div style="height:3000px"></div><div id="target" style="width:50px;height:50px"></div>',
  ],
  [
    "half past the left edge",
    '<div id="target" style="position:relative;left:-25px;width:50px;height:50px"></div>',
  ],
  [
    "clipped by an overflow ancestor",
    '<div style="overflow:hidden;width:20px;height:50px"><div id="target" style="width:80px;height:50px"></div></div>',
  ],
  [
    "scrolled out of an overflow ancestor",
    '<div style="overflow:auto;height:50px"><div style="height:200px"></div><div id="target" style="height:20px"></div></div>',
  ],
  [
    "absolute, escaping a static overflow ancestor",
    '<div style="position:relative"><div style="overflow:hidden;width:10px;height:10px"><div id="target" style="position:absolute;left:0;top:0;width:40px;height:40px"></div></div></div>',
  ],
  [
    "absolute, clipped by a positioned overflow ancestor",
    '<div style="position:relative;overflow:hidden;width:10px;height:40px"><div id="target" style="position:absolute;left:0;top:0;width:40px;height:40px"></div></div>',
  ],
  [
    "fixed, inside a clipping ancestor",
    '<div style="overflow:hidden;width:10px;height:10px"><div id="target" style="position:fixed;left:0;top:0;width:40px;height:40px"></div></div>',
  ],
  [
    "inside an inline ancestor that sets overflow",
    '<span style="overflow:hidden"><span id="target" style="display:inline-block;width:50px;height:50px"></span></span>',
  ],
  [
    "inside a display:contents ancestor that sets overflow",
    '<div style="display:contents;overflow:hidden"><div id="target" style="width:50px;height:50px"></div></div>',
  ],
  [
    "inside a table row group that sets overflow",
    '<table style="table-layout:fixed;width:10px;border-spacing:0"><tbody style="overflow:hidden"><tr><td style="padding:0"><div style="width:10px;height:10px"><div id="target" style="width:50px;height:50px"></div></div></td></tr></tbody></table>',
  ],
  [
    "clipped by a table",
    '<table style="overflow:hidden;table-layout:fixed;width:10px;height:10px;border-spacing:0"><tr><td style="padding:0"><div style="width:10px;height:10px"><div id="target" style="width:50px;height:50px"></div></div></td></tr></table>',
  ],
  [
    "absolute, inside a positioned display:contents ancestor",
    '<div style="position:relative"><div style="overflow:hidden;width:10px;height:10px"><div style="display:contents;position:relative"><div id="target" style="position:absolute;left:0;top:0;width:40px;height:40px"></div></div></div></div>',
  ],
  [
    "clipped by overflow:clip with an overflow-clip-margin",
    '<div style="overflow:clip;overflow-clip-margin:20px;width:10px;height:50px"><div id="target" style="width:50px;height:50px"></div></div>',
  ],
  [
    "clipped by overflow:clip with a content-box overflow-clip-margin",
    '<div style="overflow:clip;overflow-clip-margin:content-box 2px;padding:5px;width:10px;height:50px"><div id="target" style="width:50px;height:50px;margin-top:-5px"></div></div>',
  ],
  [
    "clipped by overflow:clip with a border-box overflow-clip-margin",
    '<div style="overflow:clip;overflow-clip-margin:border-box;border:5px solid;width:10px;height:50px"><div id="target" style="width:50px;height:50px"></div></div>',
  ],
  [
    "clipped on one axis, which ignores overflow-clip-margin",
    '<div style="overflow-x:clip;overflow-clip-margin:20px;width:10px;height:10px"><div id="target" style="width:50px;height:50px"></div></div>',
  ],
  [
    "clipped by overflow:hidden, which ignores overflow-clip-margin",
    '<div style="overflow:hidden;overflow-clip-margin:20px;width:10px;height:50px"><div id="target" style="width:50px;height:50px"></div></div>',
  ],
  ["without a box", '<div id="target" style="display:none"></div>'],
  ["with no area", '<div id="target" style="width:0;height:0"></div>'],
];

describe("layoutViewportRatio", () => {
  it.each(layouts)(
    "matches IntersectionObserver for an element %s",
    async (_name, html) => {
      document.body.innerHTML = html;
      const target = document.querySelector("#target")!;
      expect(layoutViewportRatio(target)).toBeCloseTo(
        await observedRatio(target),
        2
      );
    }
  );

  it("matches IntersectionObserver inside a shadow root", async () => {
    document.body.innerHTML =
      '<div id="host" style="overflow:hidden;width:20px;height:50px"></div>';
    const shadow = document.querySelector("#host")!.attachShadow({
      mode: "open",
    });
    shadow.innerHTML = '<div style="width:80px;height:50px"></div>';
    const target = shadow.firstElementChild!;
    expect(layoutViewportRatio(target)).toBeCloseTo(
      await observedRatio(target),
      2
    );
  });

  it("matches IntersectionObserver for an element slotted into a clipping shadow ancestor", async () => {
    document.body.innerHTML =
      '<div id="host"><div id="target" style="width:80px;height:50px"></div></div>';
    document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
      '<div style="overflow:hidden;width:20px;height:50px"><slot></slot></div>';
    const target = document.querySelector("#target")!;
    expect(layoutViewportRatio(target)).toBeCloseTo(
      await observedRatio(target),
      2
    );
  });

  it("matches IntersectionObserver in a quirks-mode document", async () => {
    // A document without a doctype: there the body, not the root, reports the
    // viewport's size.
    const frame = document.createElement("iframe");
    frame.style.cssText = "border:0;width:300px;height:200px";
    document.body.append(frame);
    // A `srcdoc` document is never in quirks mode; a written one is.
    const frameDocument = frame.contentDocument!;
    frameDocument.open();
    frameDocument.write(
      '<body style="margin:0"><div style="height:150px"></div><div id="target" style="height:100px"></div></body>'
    );
    frameDocument.close();
    expect(frameDocument.compatMode).toBe("BackCompat");
    const target = frameDocument.querySelector("#target")!;
    expect(layoutViewportRatio(target)).toBeCloseTo(
      await observedRatio(target),
      2
    );
  });
});
