/**
 * Screenshot capture of the current document, after pinned 26a9e47
 * server/screenshotter.ts. The document renders itself through SnapDOM, which
 * clones it into an SVG image and rasterizes that on a canvas, so the pixels
 * are the DOM renderer's, not the browser compositor's.
 *
 * Captures of one window take turns through a lease, as the pinned
 * `TaskQueue` serializes them per page: every `Page` of a window shares the
 * document a capture reads and prepares. The caller's deadline, signal and
 * page closure reject the call at once and restore the document; the
 * renderer cannot be stopped mid-stage, so it stops at its next stage
 * boundary, and the next capture waits only while it is still cloning.
 */

import type { Locator, Page } from "@playwright/test";
import { compressCallLog } from "./callLog";
import { AdapterTimeoutError } from "./errors";
import { isTargetClosedError, TargetClosedError } from "./lifetime";
import { validateBoolean, validateString } from "./protocolValidation";
import {
  Array,
  Error,
  Map,
  Math,
  Promise,
  Set,
  WeakMap,
} from "virtual:playwright-lite-globals";

export type PageScreenshotOptions = NonNullable<
  Parameters<Page["screenshot"]>[0]
>;
export type ElementScreenshotOptions = NonNullable<
  Parameters<Locator["screenshot"]>[0]
>;

type ScreenshotFormat = "png" | "jpeg" | "webp";

/** How a capture is encoded: pinned `validateScreenshotOptions` output. */
export type ScreenshotEncoding = {
  format: ScreenshotFormat;
  quality: number | undefined;
  omitBackground: boolean;
  scale: "css" | "device";
};

/**
 * What a capture temporarily changes in the document, and covers in its
 * output: pinned `_preparePageForScreenshot` and `_maskElements`.
 */
export type ScreenshotPreparation = {
  /** CSS added to the document and its open shadow roots; "" adds none. */
  style: string;
  /** Pinned `caret !== "initial"`: makes editable text's caret transparent. */
  hideCaret: boolean;
  /** Each mask Locator's matching elements, resolved when the capture masks. */
  mask: (() => Element[])[];
  maskColor: string;
};

/** A rectangle in document coordinates, in CSS pixels. */
export type DocumentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The options every screenshot form takes. */
const SHARED_OPTIONS = [
  "animations",
  "caret",
  "mask",
  "maskColor",
  "omitBackground",
  "path",
  "quality",
  "scale",
  "signal",
  "style",
  "timeout",
  "type",
];

/** The Page form's options; `fullPage` and `clip` are Page-only. */
export const PAGE_SCREENSHOT_OPTIONS = [...SHARED_OPTIONS, "clip", "fullPage"];
/** Element forms share the Page options but `clip` and `fullPage`. */
export const ELEMENT_SCREENSHOT_OPTIONS = SHARED_OPTIONS;

const FORMATS: ScreenshotFormat[] = ["png", "jpeg", "webp"];
const MIME_TYPES: Record<ScreenshotFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Validates `options` in the order the pinned client and protocol validator
 * read them, then applies pinned `validateScreenshotOptions`. `maskTarget`
 * resolves one `mask` entry, or returns `undefined` when it is not a Locator.
 * `animations: "disabled"` has not landed and rejects.
 */
export function pageScreenshotEncoding(
  apiName: string,
  options: PageScreenshotOptions,
  maskTarget: (value: unknown) => (() => Element[]) | undefined
): ScreenshotEncoding & PageScreenshotRegion & ScreenshotPreparation {
  return withApiPrefix(apiName, () => {
    // Pinned client/page.ts derives the type from `path` before the call,
    // and writes the file afterwards; neither has a document counterpart.
    if (options.path !== undefined)
      throw new Error(
        "the `path` option is not supported; write the returned bytes yourself."
      );
    // Pinned client/page.ts maps each mask Locator to its frame and selector
    // before the protocol validator runs.
    const mask = validateMask(options.mask, maskTarget);
    const type = validateEnum(options.type, "type", FORMATS);
    const quality = validateInt(options.quality, "quality");
    const fullPage = validateBoolean(options.fullPage, "fullPage");
    const clip =
      options.clip === undefined
        ? undefined
        : validateRect(options.clip, "clip");
    const omitBackground = validateBoolean(
      options.omitBackground,
      "omitBackground"
    );
    const caret = validateEnum(options.caret, "caret", ["hide", "initial"]);
    const animations = validateEnum(options.animations, "animations", [
      "disabled",
      "allow",
    ]);
    const scale = validateEnum(options.scale, "scale", ["css", "device"]);
    const maskColor =
      options.maskColor === undefined
        ? undefined
        : validateString(options.maskColor, "maskColor");
    const style =
      options.style === undefined ? "" : validateString(options.style, "style");
    if (animations === "disabled")
      throw new Error('`animations: "disabled"` is not supported yet.');
    const encoding = validateEncoding(type, quality, omitBackground, scale);
    // Pinned `validateScreenshotOptions` checks the clip after the codec.
    if (clip) {
      if (!(clip.width > 0))
        throw new Error("Expected options.clip.width to be greater than 0.");
      if (!(clip.height > 0))
        throw new Error("Expected options.clip.height to be greater than 0.");
    }
    return {
      ...encoding,
      fullPage: fullPage ?? false,
      clip,
      style,
      hideCaret: caret !== "initial",
      mask,
      // Pinned `_maskElements` falls back to `#F0F` for an empty color too.
      maskColor: maskColor || "#F0F",
    };
  });
}

/** What `page.screenshot()` captures, besides the encoding. */
export type PageScreenshotRegion = {
  fullPage: boolean;
  clip: DocumentRect | undefined;
};

/**
 * Pinned `screenshotPage`: the full page, or the viewport at the current
 * scroll offset, each trimmed to the clip, which uses document coordinates
 * for a full page and viewport coordinates otherwise.
 */
export function pageRegion(
  browserWindow: Window & typeof globalThis,
  { fullPage, clip }: PageScreenshotRegion
): DocumentRect {
  if (fullPage) {
    const size = fullPageSize(browserWindow.document);
    return clip ? trimClipToSize(clip, size) : { x: 0, y: 0, ...size };
  }
  const viewport = {
    width: browserWindow.innerWidth,
    height: browserWindow.innerHeight,
  };
  const rect = clip
    ? trimClipToSize(clip, viewport)
    : { x: 0, y: 0, ...viewport };
  return {
    ...rect,
    x: rect.x + browserWindow.scrollX,
    y: rect.y + browserWindow.scrollY,
  };
}

/** Pinned helper.ts `enclosingIntRect`. */
export function enclosingIntRect(rect: DocumentRect): DocumentRect {
  const x = Math.floor(rect.x + 1e-3);
  const y = Math.floor(rect.y + 1e-3);
  const x2 = Math.ceil(rect.x + rect.width - 1e-3);
  const y2 = Math.ceil(rect.y + rect.height - 1e-3);
  return { x, y, width: x2 - x, height: y2 - y };
}

/** Pinned screenshotter.ts `_fullPageSize`. */
function fullPageSize(document: Document): { width: number; height: number } {
  const { body, documentElement: root } = document;
  if (!body || !root) return { width: 0, height: 0 };
  return {
    width: Math.max(
      body.scrollWidth,
      root.scrollWidth,
      body.offsetWidth,
      root.offsetWidth,
      body.clientWidth,
      root.clientWidth
    ),
    height: Math.max(
      body.scrollHeight,
      root.scrollHeight,
      body.offsetHeight,
      root.offsetHeight,
      body.clientHeight,
      root.clientHeight
    ),
  };
}

/** Pinned screenshotter.ts `trimClipToSize`. */
function trimClipToSize(
  clip: DocumentRect,
  size: { width: number; height: number }
): DocumentRect {
  const x1 = Math.max(0, Math.min(clip.x, size.width));
  const y1 = Math.max(0, Math.min(clip.y, size.height));
  const x2 = Math.max(0, Math.min(clip.x + clip.width, size.width));
  const y2 = Math.max(0, Math.min(clip.y + clip.height, size.height));
  const result = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  if (!(result.width > 0 && result.height > 0))
    throw new Error(
      "Clipped area is either empty or outside the resulting image"
    );
  return result;
}

/**
 * The device pixels a capture of `region` covers, as Chromium's
 * `Page.captureScreenshot` takes them: the origin rounds to the nearest
 * device pixel and the size truncates to whole CSS pixels.
 */
function devicePixelRegion(region: DocumentRect, dpr: number): DocumentRect {
  const width = Math.trunc(region.width);
  const height = Math.trunc(region.height);
  if (!width) throw new Error("Cannot take screenshot with 0 width.");
  if (!height) throw new Error("Cannot take screenshot with 0 height.");
  return {
    x: Math.round(region.x * dpr) / dpr,
    y: Math.round(region.y * dpr) / dpr,
    width,
    height,
  };
}

/** Pinned screenshotter.ts `validateScreenshotOptions`, for the codec. */
function validateEncoding(
  type: ScreenshotFormat | undefined,
  quality: number | undefined,
  omitBackground: boolean | undefined,
  scale: "css" | "device" | undefined
): ScreenshotEncoding {
  const format = type ?? "png";
  if (quality !== undefined) {
    if (format === "png")
      throw new Error(
        `options.quality is unsupported for the ${format} screenshots`
      );
    if (quality < 0 || quality > 100)
      throw new Error(
        `Expected options.quality to be between 0 and 100 (inclusive), got ${quality}`
      );
  }
  return {
    format,
    quality,
    omitBackground: omitBackground ?? false,
    scale: scale ?? "device",
  };
}

/** The steps of one capture, run while it holds the window's lease. */
export type CaptureTask = {
  apiName: string;
  window: Window & typeof globalThis;
  encoding: ScreenshotEncoding;
  preparation: ScreenshotPreparation;
  /** The resolved timeout; 0 waits without a limit. */
  timeout: number;
  /** The caller's signal bound to the page's lifetime. */
  signal: AbortSignal;
  /** The first call log line, such as `taking page screenshot`. */
  title: string;
  /** Pinned `previewNode`, naming an element a capture refuses. */
  describe: (element: Element) => string;
  /**
   * Resolves the document rectangle to capture once fonts are ready, logging
   * any waiting it does; `stopped` aborts once the caller stops waiting.
   */
  region: (
    log: string[],
    stopped: AbortSignal
  ) => DocumentRect | Promise<DocumentRect>;
};

/**
 * A window's capture turns, shared by every `Page` of the window. A capture
 * holds the lease while it prepares, measures and clones the document, since
 * neither the preparation nor SnapDOM's own temporary changes to the live
 * document can overlap another capture's.
 */
type Coordinator = {
  /** Settles once every lease granted so far has been released. */
  turns: Promise<void>;
  holding: boolean;
  /** Renderers started in the window that have not settled yet. */
  renderers: number;
};

type Lease = { release: () => void };

const coordinators = new WeakMap<Window, Coordinator>();

function coordinatorFor(browserWindow: Window): Coordinator {
  let coordinator = coordinators.get(browserWindow);
  if (!coordinator) {
    coordinator = { turns: Promise.resolve(), holding: false, renderers: 0 };
    coordinators.set(browserWindow, coordinator);
  }
  return coordinator;
}

/**
 * Runs `task` once the window's earlier captures have released their lease,
 * and settles with its bytes, or rejects when the deadline passes or
 * `signal` aborts.
 */
export function capture(task: CaptureTask): Promise<Uint8Array> {
  const log: string[] = [];
  // Aborted once the caller stops waiting, for whatever reason.
  const stop = new AbortController();
  const { signal } = task;
  if (signal.aborted) return Promise.reject(aborted(signal, log, false));
  const coordinator = coordinatorFor(task.window);
  const document = task.window.document;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held = true;
  const lease: Lease = {
    release: () => {
      if (!held) return;
      held = false;
      coordinator.holding = false;
      removeRendererScaffolding(document, coordinator.renderers === 0);
      release();
    },
  };
  const previous = coordinator.turns;
  coordinator.turns = previous.then(() => released);
  const work = previous.then(() => {
    if (stop.signal.aborted) return undefined;
    coordinator.holding = true;
    return run(task, log, stop.signal, lease, coordinator);
  });
  // The lease outlives a cancelled caller while its renderer clones, and
  // otherwise ends with the capture's own work, however its caller fared.
  work.then(lease.release, lease.release);
  return new Promise<Uint8Array>((resolve, reject) => {
    let timer: number | undefined;
    const settle = (finish: () => void) => {
      if (timer !== undefined) task.window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      finish();
    };
    const cancel = (error: Error) => {
      stop.abort();
      settle(() => reject(error));
    };
    const onAbort = () => cancel(aborted(signal, log, true));
    signal.addEventListener("abort", onAbort, { once: true });
    if (task.timeout > 0)
      timer = task.window.setTimeout(
        () =>
          cancel(
            new AdapterTimeoutError(
              `${task.apiName}: Timeout ${task.timeout}ms exceeded.${callLog(log)}`
            )
          ),
        task.timeout
      );
    work.then(
      (bytes) => settle(() => resolve(bytes!)),
      // Like any failure of a pinned operation, it ends with the call log.
      (error: unknown) =>
        settle(() => {
          if (error instanceof Error) error.message += callLog(log);
          reject(error);
        })
    );
  });
}

/** Thrown at a renderer stage boundary once its caller stopped waiting. */
class CaptureCancelled extends Error {}

/**
 * The capture under the lease: preparation, fonts, region, masks, renderer,
 * checks and encoding. Once `stopped` aborts, the preparation is restored at
 * once and the renderer stops at its next stage boundary.
 */
async function run(
  task: CaptureTask,
  log: string[],
  stopped: AbortSignal,
  lease: Lease,
  coordinator: Coordinator
): Promise<Uint8Array | undefined> {
  const cancelled = () => stopped.aborted;
  const { window: browserWindow, encoding } = task;
  const document = browserWindow.document;
  log.push(task.title);
  // Pinned `_preparePageForScreenshot` prepares before waiting for fonts,
  // so the element wait and the measurements see the temporary style.
  const restore = prepareForScreenshot(
    document,
    task.preparation.style,
    task.preparation.hideCaret
  );
  let cloned = false;
  const onStop = () => {
    restore();
    if (cloned) lease.release();
  };
  stopped.addEventListener("abort", onStop, { once: true });
  try {
    // Pinned `_preparePageForScreenshot` waits for `document.fonts.ready`
    // and ignores its rejection. A cancelled call stops waiting at once, so
    // a stalled font never holds the lease for a later capture.
    log.push("waiting for fonts to load...");
    await untilStopped(
      document.fonts.ready.then(
        () => {},
        () => {}
      ),
      stopped
    );
    if (cancelled()) return undefined;
    log.push("fonts loaded");
    const dpr = encoding.scale === "css" ? 1 : browserWindow.devicePixelRatio;
    let region: DocumentRect;
    let masks: DocumentRect[];
    try {
      region = devicePixelRegion(await task.region(log, stopped), dpr);
      if (cancelled()) return undefined;
      // Pinned `_screenshot` masks once the region is known, just before
      // the capture.
      masks = maskRects(browserWindow, task.preparation.mask);
    } catch (error) {
      if (cancelled()) return undefined;
      throw withMessagePrefix(error, task.apiName);
    }
    const usedFonts = assertCapturableContent(task, region, masks);
    const renderer = await loadRenderer();
    if (cancelled()) return undefined;
    const root = document.documentElement;
    let svg = "";
    let rootColor: string | undefined;
    // SnapDOM awaits each hook without catching, so a throw ends its
    // pipeline: the only way to stop it, and only between stages. A
    // same-origin frame is rendered by a nested capture with the same hooks.
    const stage = (context: { element?: unknown }, onRoot?: () => void) => {
      if (context.element === root) onRoot?.();
      if (cancelled()) throw new CaptureCancelled();
    };
    // Rendered without a fill, so the page's own background shows through;
    // `compose` paints the canvas background the browser would paint under
    // it.
    coordinator.renderers++;
    const rendering = renderer(root, {
      clip: region,
      dpr,
      scale: 1,
      backgroundColor: null,
      cache: "disabled",
      invalidate: true,
      plugins: [
        {
          name: "playwright-lite-capture",
          beforeSnap: (context) => stage(context),
          beforeClone: (context) => stage(context),
          // SnapDOM undoes its own changes to the live document, such as
          // rewritten line-clamped text, before this hook.
          afterClone: (context) =>
            stage(context, () => {
              cloned = true;
              if (cancelled()) lease.release();
            }),
          beforeRender: (context) => stage(context),
          // Composing reads the live document's layout right up to here;
          // exporting reads only the SVG.
          afterRender: (context) =>
            stage(context, () => {
              svg = context.svgString ?? "";
              rootColor = rootBackgroundColor(browserWindow);
              restore();
            }),
          beforeExport: (context) => stage(context),
          afterExport: (context) => stage(context),
        },
      ],
    }).then(async (result) => ({ result, canvas: await result.toCanvas() }));
    const settled = () => {
      coordinator.renderers--;
      if (coordinator.renderers === 0 && !coordinator.holding)
        removeRendererScaffolding(document, true);
    };
    rendering.then(settled, settled);
    let result: Awaited<ReturnType<Renderer>>;
    let rendered: HTMLCanvasElement;
    try {
      ({ result, canvas: rendered } = await rendering);
    } catch (error) {
      if (cancelled()) return undefined;
      throw withMessagePrefix(error, task.apiName);
    }
    if (cancelled()) return undefined;
    // A degraded capture is a failure, never a placeholder: SnapDOM records
    // each substitution it made, such as an image it could not load or an
    // output it downscaled, as a warning. `reconcile-risk` only notes that
    // inline text was laid out without a second measuring pass.
    const degradations = result.warnings.filter(
      (warning) => warning.code !== "reconcile-risk"
    );
    if (degradations.length)
      throw new Error(
        `${task.apiName}: the capture is incomplete: ${degradations.map((warning) => warning.message).join("; ")}`
      );
    const embedded = embeddedFontFamilies(svg);
    for (const [name, { family, element }] of usedFonts)
      if (!embedded.has(name))
        throw new Error(
          `${task.apiName}: cannot capture ${task.describe(element)}: its text uses the "${family}" web font, which the renderer could not embed.`
        );
    const output = compose(document, rendered, encoding, rootColor);
    paintMasks(output, masks, region, dpr, task.preparation.maskColor);
    const blob = await new Promise<Blob | null>((resolve) =>
      output.toBlob(
        resolve,
        MIME_TYPES[encoding.format],
        encoding.format === "jpeg"
          ? (encoding.quality ?? 80) / 100
          : encoding.format === "webp"
            ? (encoding.quality ?? 100) / 100
            : undefined
      )
    );
    // A browser that cannot encode a type silently returns a PNG instead.
    if (!blob || blob.type !== MIME_TYPES[encoding.format])
      throw new Error(
        `${task.apiName}: this browser cannot encode ${encoding.format} images.`
      );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return cancelled() ? undefined : bytes;
  } finally {
    stopped.removeEventListener("abort", onStop);
    restore();
  }
}

/**
 * SnapDOM keeps a hidden style sandbox in `<body>` while it clones and
 * removes it only when composing succeeds; it also leaves the hidden
 * `<iframe>` it decodes images in attached after exporting. Only the lease
 * holder clones, so the sandbox is unused between leases; the frame is
 * removed only when no renderer of the window is running. SnapDOM creates
 * either again when it needs it.
 */
function removeRendererScaffolding(document: Document, frame: boolean) {
  for (const element of document.querySelectorAll(
    frame
      ? "iframe[data-snapdom-internal], #snapdom-sandbox[data-snapdom-internal]"
      : "#snapdom-sandbox[data-snapdom-internal]"
  ))
    element.remove();
}

/**
 * Pinned screenshotter.ts `inPagePrepareForScreenshots`, style and caret
 * parts, for the document and its open shadow roots. The pinned function
 * keeps its cleanup in one `window.__pwCleanupScreenshot`; this returns it,
 * since every `Page` of a window shares the document. The cleanup runs once,
 * and puts back each touched `style` attribute's own text, where the pinned
 * one leaves it re-serialized and adds `style=""` to elements that had none.
 */
function prepareForScreenshot(
  document: Document,
  style: string,
  hideCaret: boolean
): () => void {
  const cleanups: (() => void)[] = [];
  const roots = shadowRootsAndDocument(document);
  if (style)
    for (const root of roots) {
      const element = document.createElement("style");
      element.textContent = style;
      if (root === document) document.documentElement.append(element);
      else root.append(element);
      cleanups.push(() => element.remove());
    }
  if (hideCaret) {
    const carets = new Map<
      HTMLElement,
      { value: string; priority: string; attribute: string | null; css: string }
    >();
    for (const root of roots)
      for (const element of root.querySelectorAll<HTMLElement>(
        "input,textarea,[contenteditable]"
      )) {
        carets.set(element, {
          value: element.style.getPropertyValue("caret-color"),
          priority: element.style.getPropertyPriority("caret-color"),
          attribute: element.getAttribute("style"),
          css: element.style.cssText,
        });
        element.style.setProperty("caret-color", "transparent", "important");
      }
    cleanups.push(() => {
      for (const [element, before] of carets) {
        element.style.setProperty("caret-color", before.value, before.priority);
        // Unless the page changed the inline style meanwhile, its own
        // attribute text goes back too.
        if (element.style.cssText !== before.css) continue;
        // Chromium writes CSSOM changes back to the attribute lazily, and a
        // pending write-back can recreate a removed attribute; reading it
        // first settles the write-back.
        if (before.attribute === null) {
          element.getAttribute("style");
          element.removeAttribute("style");
        } else if (element.getAttribute("style") !== before.attribute)
          element.setAttribute("style", before.attribute);
      }
    });
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const cleanup of cleanups) cleanup();
  };
}

/** Pinned `collectRoots`: the document, then each open shadow root. */
function shadowRootsAndDocument(
  root: Document | ShadowRoot,
  roots: (Document | ShadowRoot)[] = []
): (Document | ShadowRoot)[] {
  roots.push(root);
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const shadowRoot = (node as Element).shadowRoot;
    if (shadowRoot) shadowRootsAndDocument(shadowRoot, roots);
  }
  return roots;
}

/**
 * The document rectangles pinned highlight.ts paints for each mask element:
 * its bounding box in the fixed glass pane, which Chromium snaps to whole
 * CSS pixels.
 */
function maskRects(
  browserWindow: Window & typeof globalThis,
  mask: (() => Element[])[]
): DocumentRect[] {
  const rects: DocumentRect[] = [];
  for (const resolve of mask)
    for (const element of resolve()) {
      const rect = snappedRect(browserWindow, element.getBoundingClientRect());
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    }
  return rects;
}

/**
 * A viewport box in document coordinates, its edges rounded to whole CSS
 * pixels as Chromium snaps a box it paints.
 */
function snappedRect(
  browserWindow: Window & typeof globalThis,
  box: DOMRect
): DocumentRect {
  const x = Math.round(box.left);
  const y = Math.round(box.top);
  return {
    x: x + browserWindow.scrollX,
    y: y + browserWindow.scrollY,
    width: Math.round(box.right) - x,
    height: Math.round(box.bottom) - y,
  };
}

/**
 * Paints each mask over the composed capture, above every layer of the page
 * as the pinned glass pane is. A color the browser cannot parse paints
 * nothing, as an invalid `background-color` does.
 */
function paintMasks(
  output: HTMLCanvasElement,
  masks: DocumentRect[],
  region: DocumentRect,
  dpr: number,
  color: string
) {
  if (!masks.length) return;
  const context = output.getContext("2d")!;
  if (!setFillColor(context, color)) return;
  const originX = Math.round(region.x * dpr);
  const originY = Math.round(region.y * dpr);
  for (const mask of masks)
    context.fillRect(
      mask.x * dpr - originX,
      mask.y * dpr - originY,
      mask.width * dpr,
      mask.height * dpr
    );
}

/**
 * A canvas ignores a color it cannot parse and keeps its current fill, so a
 * color is valid when it replaces both of two different fills.
 */
function setFillColor(
  context: CanvasRenderingContext2D,
  color: string
): boolean {
  for (const current of ["#000000", "#ffffff"]) {
    context.fillStyle = current;
    context.fillStyle = color;
    if (context.fillStyle !== current) return true;
  }
  return false;
}

/**
 * Paints the canvas background, then the rendered document. The browser
 * starts from white, which `omitBackground` makes transparent for every type
 * but JPEG, and paints the root background, propagated from `<body>` when
 * `<html>` has none, over the whole canvas, beyond the root element's box.
 * `rootColor` is read while the capture's preparation still applies.
 */
function compose(
  document: Document,
  rendered: HTMLCanvasElement,
  encoding: ScreenshotEncoding,
  rootColor: string | undefined
): HTMLCanvasElement {
  const output = document.createElement("canvas");
  output.width = rendered.width;
  output.height = rendered.height;
  const context = output.getContext("2d")!;
  if (!encoding.omitBackground || encoding.format === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
  }
  if (rootColor) {
    context.fillStyle = rootColor;
    context.fillRect(0, 0, output.width, output.height);
  }
  context.drawImage(rendered, 0, 0);
  return output;
}

/** CSS Backgrounds 3 §2.11.2: the background the root propagates to the canvas. */
function rootBackgroundColor(
  browserWindow: Window & typeof globalThis
): string | undefined {
  const document = browserWindow.document;
  const root = document.documentElement;
  let style = browserWindow.getComputedStyle(root);
  const body = document.body;
  if (
    isTransparent(style) &&
    root.localName === "html" &&
    body?.localName === "body"
  )
    style = browserWindow.getComputedStyle(body);
  const color = style.backgroundColor;
  return isTransparentColor(color) ? undefined : color;
}

function isTransparent(style: CSSStyleDeclaration): boolean {
  return (
    isTransparentColor(style.backgroundColor) &&
    style.backgroundImage === "none"
  );
}

function isTransparentColor(color: string): boolean {
  return (
    color === "transparent" ||
    /^rgba\(.*,\s*0\)$/.test(color) ||
    /\/\s*0\)$/.test(color)
  );
}

/** Elements whose pixels the renderer cannot yet prove it reproduced. */
const UNVERIFIED_ELEMENTS = new Set([
  "video",
  "iframe",
  "frame",
  "object",
  "embed",
]);

/** Properties that paint an image from a URL. */
const URL_IMAGE_PROPERTIES = [
  "background-image",
  "mask-image",
  "-webkit-mask-image",
  "border-image-source",
  "list-style-image",
  "content",
];

/**
 * Refuses content in `region` the renderer cannot reproduce or would replace
 * without a warning, and returns the web fonts its text uses: the family the
 * capture must embed, by lowercase name, and the first element that uses it.
 * A canvas the page cannot read back renders blank, and SnapDOM substitutes
 * failed frames, video and URL images in CSS and SVG silently, so they cannot
 * yet be verified; `<img>` failures are reported by the renderer itself.
 * Elements inside a mask are skipped.
 */
function assertCapturableContent(
  task: CaptureTask,
  region: DocumentRect,
  masks: DocumentRect[]
): Map<string, { family: string; element: Element }> {
  const browserWindow = task.window;
  const refuse = (element: Element, reason: string): never => {
    throw new Error(
      `${task.apiName}: cannot capture ${task.describe(element)}: ${reason}`
    );
  };
  const webFonts = loadedWebFontFamilies(browserWindow.document);
  const usedFonts = new Map<string, { family: string; element: Element }>();
  for (const element of renderedElements(browserWindow.document)) {
    const box = element.getBoundingClientRect();
    const rect = {
      x: box.left + browserWindow.scrollX,
      y: box.top + browserWindow.scrollY,
      width: box.width,
      height: box.height,
    };
    // A masked element's pixels are painted over, whatever they would be;
    // its own mask covers its box snapped as the mask is.
    const painted = snappedRect(browserWindow, box);
    if (
      !intersects(region, rect) ||
      masks.some((mask) => contains(mask, painted))
    )
      continue;
    const name = element.localName;
    if (name === "canvas" && !isReadable(element as HTMLCanvasElement))
      refuse(
        element,
        "its pixels cannot be read back, since cross-origin content tainted it."
      );
    if (UNVERIFIED_ELEMENTS.has(name) && !isSvg(element))
      refuse(element, `capturing <${name}> content is not supported yet.`);
    if (
      isSvg(element) &&
      (name === "image" || name === "feImage") &&
      isUnverifiedURL(
        element.getAttribute("href") ?? element.getAttribute("xlink:href")
      )
    )
      refuse(
        element,
        "capturing an SVG image from a URL is not supported yet."
      );
    for (const pseudo of [null, "::before", "::after", "::marker"]) {
      const style = browserWindow.getComputedStyle(element, pseudo);
      const family =
        pseudo === "::marker" || !rendersText(element, pseudo, style)
          ? undefined
          : renderedWebFont(fontFamilies(style.fontFamily), webFonts);
      if (family && !usedFonts.has(family.toLowerCase()))
        usedFonts.set(family.toLowerCase(), { family, element });
      for (const property of URL_IMAGE_PROPERTIES) {
        const value = style.getPropertyValue(property);
        if (cssURLs(value).some(isUnverifiedURL))
          refuse(
            element,
            `capturing a CSS ${property} from a URL is not supported yet.`
          );
      }
    }
  }
  return usedFonts;
}

/**
 * The families the rendered SVG embeds as data. SnapDOM skips a web font
 * without a warning, such as one added through the `FontFace` API or one whose
 * name looks like an icon font's; the page's own `@font-face` rules it copies
 * keep URLs the rendered image cannot load. Text in such a font would render
 * in a fallback font.
 */
function embeddedFontFamilies(svg: string): Set<string> {
  const families = new Set<string>();
  for (const [, rule] of svg.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const family = /font-family\s*:\s*(['"]?)([^;'"]+)\1/i.exec(rule);
    if (family && /url\(\s*['"]?data:/i.test(rule))
      families.add(family[2].trim().toLowerCase());
  }
  return families;
}

function loadedWebFontFamilies(document: Document): Set<string> {
  const families = new Set<string>();
  for (const face of document.fonts)
    if (face.status === "loaded")
      families.add(face.family.replace(/^(['"])(.*)\1$/, "$2").toLowerCase());
  return families;
}

/**
 * CSS Fonts 4 §2.1.1 generic families, which always match, so the browser
 * never falls back past one.
 */
const GENERIC_FAMILY =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;

/**
 * The web font that renders text in `families`: the first loaded one before
 * any generic family. A family that is neither may or may not be installed,
 * so a web font after it counts as used.
 */
function renderedWebFont(
  families: string[],
  webFonts: Set<string>
): string | undefined {
  for (const family of families) {
    if (webFonts.has(family.toLowerCase())) return family;
    if (GENERIC_FAMILY.test(family)) return undefined;
  }
  return undefined;
}

/** The families of a computed `font-family`, unquoted, in order. */
function fontFamilies(value: string): string[] {
  return Array.from(
    value.matchAll(
      /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+))\s*(?:,|$)/g
    ),
    (match) => (match[1] ?? match[2] ?? match[3]).trim()
  ).filter(Boolean);
}

/** Whether `element`, or its `pseudo` element, paints text of its own. */
function rendersText(
  element: Element,
  pseudo: string | null,
  style: CSSStyleDeclaration
): boolean {
  if (pseudo) return style.content !== "none" && style.content !== "normal";
  if (
    (element.localName === "input" || element.localName === "textarea") &&
    ((element as HTMLInputElement).value ||
      (element as HTMLInputElement).placeholder)
  )
    return true;
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === 3 /* TEXT_NODE */ && node.nodeValue!.trim()
  );
}

/** Every element of `document` and of the open shadow roots inside it. */
function* renderedElements(root: Document | ShadowRoot): Generator<Element> {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    yield element;
    if (element.shadowRoot) yield* renderedElements(element.shadowRoot);
  }
}

function intersects(a: DocumentRect, b: DocumentRect): boolean {
  return (
    b.width > 0 &&
    b.height > 0 &&
    b.x < a.x + a.width &&
    b.x + b.width > a.x &&
    b.y < a.y + a.height &&
    b.y + b.height > a.y
  );
}

function contains(outer: DocumentRect, inner: DocumentRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Reads one pixel of `canvas` through a scratch canvas, which a tainted
 * source taints in turn. Asking `canvas` for a context would create one, so
 * its own context and pixels are never touched.
 */
function isReadable(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return true;
  const scratch = canvas.ownerDocument.createElement("canvas");
  scratch.width = scratch.height = 1;
  const context = scratch.getContext("2d")!;
  context.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
  try {
    context.getImageData(0, 0, 1, 1);
    return true;
  } catch (error) {
    if ((error as Error)?.name === "SecurityError") return false;
    throw error;
  }
}

function isSvg(element: Element): boolean {
  return element.namespaceURI === "http://www.w3.org/2000/svg";
}

function cssURLs(value: string): string[] {
  return Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)).map(
    (match) => match[2]
  );
}

/** A URL the renderer would fetch; `data:` URLs are embedded as they are. */
function isUnverifiedURL(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return !/^data:/i.test(trimmed) && !trimmed.startsWith("#");
}

type Renderer = typeof import("@zumer/snapdom").snapdom;
let renderer: Promise<Renderer> | undefined;

/**
 * SnapDOM loads with the first capture and is reused after; a failed load is
 * forgotten, so a later capture tries again.
 */
function loadRenderer(): Promise<Renderer> {
  renderer ??= import("@zumer/snapdom").then(
    (module) => module.snapdom,
    (error: unknown) => {
      renderer = undefined;
      throw error;
    }
  );
  return renderer;
}

/** Settles when `promise` does or `stopped` aborts, whichever is first. */
function untilStopped(
  promise: Promise<void>,
  stopped: AbortSignal
): Promise<void> {
  if (stopped.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      stopped.removeEventListener("abort", done);
      resolve();
    };
    stopped.addEventListener("abort", done, { once: true });
    promise.then(done);
  });
}

function callLog(log: string[]): string {
  return log.length ? `\nCall log:\n${compressCallLog(log).join("\n")}` : "";
}

/**
 * The error of an aborted capture: the closed error when the page closed,
 * otherwise an `AbortError` that names the reason and, in flight, the call
 * log, as pinned client/connection.ts reports `__abort__`.
 */
function aborted(signal: AbortSignal, log: string[], inFlight: boolean) {
  if (isTargetClosedError(signal.reason))
    return new TargetClosedError(signal.reason.reason);
  const reason: unknown = signal.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const error = new Error(
    inFlight
      ? `${message}${callLog([...log, `operation was aborted: ${message}`])}`
      : "The operation was aborted",
    { cause: signal.reason }
  );
  error.name = "AbortError";
  return error;
}

function withApiPrefix<T>(apiName: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw withMessagePrefix(error, apiName);
  }
}

function withMessagePrefix(error: unknown, apiName: string): unknown {
  if (error instanceof Error) error.message = `${apiName}: ${error.message}`;
  return error;
}

/** Pinned validatorPrimitives.ts `tEnum`. */
function validateEnum<T extends string>(
  value: unknown,
  name: string,
  values: T[]
): T | undefined {
  if (value === undefined) return undefined;
  if (!values.includes(value as T))
    throw new Error(`${name}: expected one of (${values.join("|")})`);
  return value as T;
}

/** Pinned validatorPrimitives.ts `tInt`. */
function validateInt(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const number = value instanceof Number ? value.valueOf() : value;
  if (typeof number !== "number")
    throw new Error(`${name}: expected integer, got ${typeof value}`);
  if (!Number.isInteger(number))
    throw new Error(`${name}: expected integer, got float ${number}`);
  return number;
}

/** Pinned validatorPrimitives.ts `tFloat`. */
function validateFloat(value: unknown, name: string): number {
  if (value instanceof Number) return value.valueOf();
  if (typeof value === "number") return value;
  throw new Error(`${name}: expected float, got ${typeof value}`);
}

/** Pinned validator.ts `Rect`. */
function validateRect(value: unknown, name: string): DocumentRect {
  if (value === null) throw new Error(`${name}: expected object, got null`);
  if (typeof value !== "object")
    throw new Error(`${name}: expected object, got ${typeof value}`);
  const rect = value as Record<string, unknown>;
  return {
    x: validateFloat(rect.x, `${name}.x`),
    y: validateFloat(rect.y, `${name}.y`),
    width: validateFloat(rect.width, `${name}.width`),
    height: validateFloat(rect.height, `${name}.height`),
  };
}

/** `mask` is an array of Locators; an empty one masks nothing. */
function validateMask(
  value: unknown,
  maskTarget: (value: unknown) => (() => Element[]) | undefined
): (() => Element[])[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error(`mask: expected array, got ${typeof value}`);
  return value.map((entry: unknown, index) => {
    const target = maskTarget(entry);
    if (!target)
      throw new Error(
        `mask[${index}]: expected Locator, got ${entry === null ? "null" : typeof entry}`
      );
    return target;
  });
}
