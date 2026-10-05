import { Math } from "virtual:playwright-lite-globals";

/**
 * The share of `element` inside the viewport, read from layout: what pinned
 * `InjectedScript.viewportRatio` asks an IntersectionObserver for. A hidden
 * document never renders, so the browser never delivers that observer's
 * report; this measures the same intersection directly.
 *
 * Like an observer with the implicit root, the element's border box is
 * clipped by every ancestor in its containing-block chain that clips its
 * overflow, then by the viewport. An element with no box reports 0, and a box
 * with no area reports 1 when it touches the viewport.
 */
export function layoutViewportRatio(element: Element): number {
  const browserWindow = element.ownerDocument.defaultView;
  if (
    !browserWindow ||
    !element.isConnected ||
    !element.getClientRects().length
  )
    return 0;
  const box = element.getBoundingClientRect();
  let { left, top, right, bottom } = box;
  let position = browserWindow.getComputedStyle(element).position;

  const root = element.ownerDocument.documentElement;
  const rootStyle = browserWindow.getComputedStyle(root);
  // The body's overflow belongs to the viewport unless the root sets its own.
  const bodyClips =
    rootStyle.overflowX !== "visible" || rootStyle.overflowY !== "visible";
  for (
    let ancestor = parentOrHost(element);
    ancestor && ancestor !== root && position !== "fixed";
    ancestor = parentOrHost(ancestor)
  ) {
    const style = browserWindow.getComputedStyle(ancestor);
    // An absolutely positioned box escapes ancestors up to its containing
    // block, the nearest positioned one.
    const contains = position !== "absolute" || style.position !== "static";
    if (!contains) continue;
    if (ancestor === element.ownerDocument.body && !bodyClips) {
      position = style.position;
      continue;
    }
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";
    if (clipsX || clipsY) {
      const outer = ancestor.getBoundingClientRect();
      const innerLeft = outer.left + ancestor.clientLeft;
      const innerTop = outer.top + ancestor.clientTop;
      if (clipsX) {
        left = Math.max(left, innerLeft);
        right = Math.min(right, innerLeft + ancestor.clientWidth);
      }
      if (clipsY) {
        top = Math.max(top, innerTop);
        bottom = Math.min(bottom, innerTop + ancestor.clientHeight);
      }
    }
    position = style.position;
  }

  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, root.clientWidth);
  bottom = Math.min(bottom, root.clientHeight);
  if (right < left || bottom < top) return 0;
  const area = box.width * box.height;
  if (!area) return 1;
  return ((right - left) * (bottom - top)) / area;
}

function parentOrHost(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.parentNode;
  return root && "host" in root ? (root as ShadowRoot).host : null;
}
