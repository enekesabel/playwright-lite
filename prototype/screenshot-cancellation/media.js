// Detection of known silent media degradation in a SnapDOM capture, at three
// points: a live pre-scan before capture, the clone (afterClone), and the
// serialized SVG the rasterizer will draw (afterRender).

const XLINK = "http://www.w3.org/1999/xlink";

/**
 * Whether drawing `source` leaves a canvas readable. Reads through a 1x1
 * scratch canvas: drawImage binds no context to the source, and the source's
 * pixels and context state are never touched (SnapDOM 3.2.0 core/clone.js
 * isBlankCanvas uses the same route for the same reason).
 */
export function readable(source) {
  const scratch = document.createElement("canvas");
  scratch.width = 1;
  scratch.height = 1;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  try {
    context.drawImage(source, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
    return { readable: true };
  } catch (error) {
    return { readable: false, error: error.name };
  }
}

/** SnapDOM 3.2.0 core/clone.js cloneVideo: when it draws the poster, not a frame. */
function showsPoster(video) {
  return Boolean(
    video.poster && video.paused && !video.currentTime && !video.played.length
  );
}

function intersects(element, rect) {
  if (!rect) return true;
  const box = element.getBoundingClientRect();
  return (
    box.right > rect.x &&
    box.left < rect.x + rect.width &&
    box.bottom > rect.y &&
    box.top < rect.y + rect.height
  );
}

function describe(element) {
  return (
    element.localName +
    (element.id ? `#${element.id}` : "") +
    (element.getAttribute("src") ? `[src=${element.getAttribute("src")}]` : "")
  );
}

/**
 * Live pre-scan of the content a capture would include. Runs before the
 * renderer, so a rejection costs no rendering and changes nothing.
 */
export function preScan(root, rect) {
  const findings = [];
  const elements = [root, ...root.querySelectorAll("canvas,video,iframe")];
  for (const element of elements) {
    if (!intersects(element, rect)) continue;
    if (element.localName === "canvas") {
      const result = readable(element);
      if (!result.readable)
        findings.push({
          kind: "unreadable-canvas",
          element: describe(element),
          error: result.error,
        });
    } else if (element.localName === "video") {
      if (showsPoster(element)) continue;
      if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        findings.push({
          kind: "video-without-frame",
          element: describe(element),
          readyState: element.readyState,
        });
        continue;
      }
      const result = readable(element);
      if (!result.readable)
        findings.push({
          kind: "unreadable-video",
          element: describe(element),
          error: result.error,
        });
    } else if (element.localName === "iframe") {
      let document = null;
      try {
        document = element.contentDocument;
      } catch {
        document = null;
      }
      if (!document)
        findings.push({
          kind: "cross-origin-iframe",
          element: describe(element),
        });
      // SnapDOM rasterizes a same-origin frame with a nested capture.
      else if (document.documentElement)
        findings.push(
          ...preScan(document.documentElement).map((finding) => ({
            ...finding,
            frame: describe(element),
          }))
        );
    }
  }
  return findings;
}

/**
 * afterClone: SnapDOM's clone-to-source map shows what each media element
 * became. Clip-culled content is not in it, so the check covers only what
 * the capture includes.
 */
export function cloneScan(context) {
  const findings = [];
  const replaced = { canvas: 0, video: 0, iframe: 0 };
  for (const [clone, source] of context.nodeMap ?? []) {
    if (!(source instanceof Element)) continue;
    const name = source.localName;
    if (name === "canvas" || name === "video") {
      replaced[name]++;
      const src = clone.getAttribute?.("src") ?? "";
      const isFrame =
        /^data:image\/(png|jpeg);base64,/.test(src) && src !== "data:,";
      if (name === "canvas" && !isFrame)
        findings.push({
          kind: "canvas-not-captured",
          element: describe(source),
        });
      if (name === "video" && !isFrame && !showsPoster(source))
        findings.push({
          kind: "video-frame-not-captured",
          element: describe(source),
          substitute: src ? "poster" : "empty",
        });
    }
    if (
      name === "video" &&
      !showsPoster(source) &&
      source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      findings.push({
        kind: "video-frame-not-captured",
        element: describe(source),
        substitute: "blank",
      });
    if (name === "iframe") replaced.iframe++;
  }
  return { findings, replaced };
}

/**
 * afterRender: an SVG drawn as an image loads no external resource, so any
 * reference that is not a data URL or a fragment renders blank.
 */
export function svgScan(serialized) {
  const findings = [];
  const svgString = serialized
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
  const urls = svgString.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/g);
  for (const [, , url] of urls)
    if (!/^(data:|#|$)/i.test(url.trim()))
      findings.push({ kind: "external-css-url", url: url.slice(0, 120) });
  const attributes = svgString.matchAll(/\s(?:xlink:)?(href|src)="([^"]*)"/g);
  for (const [, attribute, value] of attributes)
    if (value && !/^(data:|#)/i.test(value))
      findings.push({
        kind: `external-${attribute}`,
        url: value.slice(0, 120),
      });
  return findings;
}

/**
 * afterRender: modules/images.js replaces a failed <img> in the clone with a
 * placeholder, or with `placeholders: false` a spacer that reports no
 * warning. Either way the <img> clone has left the tree.
 */
export function imageScan(context) {
  const findings = [];
  for (const [clone, source] of context.nodeMap ?? [])
    if (
      source instanceof HTMLImageElement &&
      clone !== context.clone &&
      !context.clone?.contains(clone)
    )
      findings.push({ kind: "image-substituted", element: describe(source) });
  return findings;
}

/** Inline-SVG `<image>` hrefs that SnapDOM left external (modules/images.js). */
export function liveSvgImages(root) {
  return [...root.querySelectorAll("image")].map(
    (image) =>
      image.getAttribute("href") ||
      image.getAttributeNS(XLINK, "href") ||
      image.getAttribute("xlink:href")
  );
}

/**
 * afterRender: a document webfont used by captured text but absent from the
 * SVG's @font-face rules renders in a fallback font. SnapDOM 3.2.0 skips
 * families its icon-name heuristic matches (modules/iconFonts.js isIconFont)
 * and font fetches it cannot complete, without a warning.
 */
export function fontScan(context) {
  const loaded = new Set();
  for (const face of document.fonts)
    if (face.status === "loaded")
      loaded.add(unquote(face.family).toLowerCase());
  const used = new Set();
  for (const [, source] of context.nodeMap ?? []) {
    const element = source instanceof Element ? source : source?.parentElement;
    if (
      !element ||
      !(source instanceof Text ? source.data.trim() : element.childNodes.length)
    )
      continue;
    const family = unquote(
      getComputedStyle(element).fontFamily.split(",")[0] ?? ""
    ).toLowerCase();
    if (loaded.has(family)) used.add(family);
  }
  const embedded = new Set(
    [
      ...(context.svgString ?? "").matchAll(
        /@font-face\s*{[^}]*font-family:\s*([^;]+);/g
      ),
    ].map(([, family]) => unquote(family).toLowerCase())
  );
  return [...used]
    .filter((family) => !embedded.has(family))
    .map((family) => ({ kind: "webfont-not-embedded", family }));
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}
