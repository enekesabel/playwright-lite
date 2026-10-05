import { Math, Set } from "virtual:playwright-lite-globals";

/**
 * The share of `element` inside the viewport, read from layout: what pinned
 * `InjectedScript.viewportRatio` asks an IntersectionObserver for. A hidden
 * document never renders, so the browser never delivers that observer's
 * report; this measures the same intersection directly.
 *
 * Like an observer with the implicit root, the element's border box is
 * clipped by every flat-tree ancestor in its containing-block chain that clips
 * its overflow, then by the viewport. An element with no box reports 0, and a
 * box with no area reports 1 when it touches the viewport.
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
    let ancestor = flatTreeParent(element);
    ancestor && ancestor !== root && position !== "fixed";
    ancestor = flatTreeParent(ancestor)
  ) {
    const style = browserWindow.getComputedStyle(ancestor);
    // No box: it neither clips nor contains anything.
    if (style.display === "contents") continue;
    // An absolutely positioned box escapes ancestors up to its containing
    // block, the nearest positioned one.
    const contains = position !== "absolute" || style.position !== "static";
    if (!contains) continue;
    position = style.position;
    if (ancestor === element.ownerDocument.body && !bodyClips) continue;
    if (UNCLIPPED_DISPLAYS.has(style.display)) continue;
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";
    if (!clipsX && !clipsY) continue;
    const clip = overflowClip(ancestor, style);
    if (clipsX) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (clipsY) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
  }

  left = Math.max(left, 0);
  top = Math.max(top, 0);
  // A quirks-mode document reports the viewport's size on its body.
  const viewport =
    (element.ownerDocument.compatMode === "BackCompat" &&
      element.ownerDocument.body) ||
    root;
  right = Math.min(right, viewport.clientWidth);
  bottom = Math.min(bottom, viewport.clientHeight);
  if (right < left || bottom < top) return 0;
  const area = box.width * box.height;
  if (!area) return 1;
  return ((right - left) * (bottom - top)) / area;
}

/** Boxes that `overflow` does not apply to. */
const UNCLIPPED_DISPLAYS = new Set([
  "inline",
  "table-row",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-column",
  "table-column-group",
]);

/**
 * Where `ancestor` clips its overflow: its padding box less any scrollbar, or
 * for `overflow: clip` on both axes, the `overflow-clip-margin` box.
 */
function overflowClip(ancestor: Element, style: CSSStyleDeclaration) {
  const border = ancestor.getBoundingClientRect();
  let left = border.left + ancestor.clientLeft;
  let top = border.top + ancestor.clientTop;
  let right = left + ancestor.clientWidth;
  let bottom = top + ancestor.clientHeight;
  if (style.overflowX !== "clip" || style.overflowY !== "clip")
    return { left, top, right, bottom };
  let margin = 0;
  for (const part of style.overflowClipMargin.split(" ")) {
    if (part === "border-box") ({ left, top, right, bottom } = border);
    else if (part === "content-box") {
      left += px(style.paddingLeft);
      top += px(style.paddingTop);
      right -= px(style.paddingRight);
      bottom -= px(style.paddingBottom);
    } else if (part !== "padding-box") margin = px(part);
  }
  return {
    left: left - margin,
    top: top - margin,
    right: right + margin,
    bottom: bottom + margin,
  };
}

/** A computed length, which the browser always reports in `px`. */
function px(length: string): number {
  return +length.slice(0, -2) || 0;
}

/** The parent in the flat tree, where a slotted element sits in its slot. */
function flatTreeParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.parentNode;
  return root && "host" in root ? (root as ShadowRoot).host : null;
}
