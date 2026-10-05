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
});
