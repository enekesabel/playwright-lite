/**
 * Screenshot capture of the current document, after pinned 26a9e47
 * server/screenshotter.ts. The document renders itself through SnapDOM, which
 * clones it into an SVG image and rasterizes that on a canvas, so the pixels
 * are the DOM renderer's, not the browser compositor's.
 *
 * One queue per window serializes captures, as the pinned `TaskQueue` does
 * per page: every `Page` of a window shares the document a capture reads.
 * The caller's deadline, signal and page closure reject the call at once; the
 * queued task notices at its next step and stops, but renderer work already
 * started cannot be stopped, so the queue waits for it and drops its result.
 */

import type { Page } from "@playwright/test";
import { compressCallLog } from "./callLog";
import { AdapterTimeoutError } from "./errors";
import { isTargetClosedError, TargetClosedError } from "./lifetime";
import { validateBoolean, validateString } from "./protocolValidation";
import {
  Array,
  Error,
  Map,
  Promise,
  Set,
  WeakMap,
} from "virtual:playwright-lite-globals";

export type PageScreenshotOptions = NonNullable<
  Parameters<Page["screenshot"]>[0]
>;

type ScreenshotFormat = "png" | "jpeg" | "webp";

/** How a capture is encoded: pinned `validateScreenshotOptions` output. */
export type ScreenshotEncoding = {
  format: ScreenshotFormat;
  quality: number | undefined;
  omitBackground: boolean;
  scale: "css" | "device";
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

const FORMATS: ScreenshotFormat[] = ["png", "jpeg", "webp"];
const MIME_TYPES: Record<ScreenshotFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Validates `options` in the order the pinned protocol validator reads
 * `PageScreenshotParams`, then applies pinned `validateScreenshotOptions`.
 * Options whose behaviour has not landed reject, while their default forms,
 * which change nothing, are accepted.
 */
export function pageScreenshotEncoding(
  apiName: string,
  options: PageScreenshotOptions
): ScreenshotEncoding {
  return withApiPrefix(apiName, () => {
    // Pinned client/page.ts derives the type from `path` before the call,
    // and writes the file afterwards; neither has a document counterpart.
    if (options.path !== undefined)
      throw new Error(
        "the `path` option is not supported; write the returned bytes yourself."
      );
    const type = validateEnum(options.type, "type", FORMATS);
    const quality = validateInt(options.quality, "quality");
    const fullPage = validateBoolean(options.fullPage, "fullPage");
    if (options.clip !== undefined) {
      validateRect(options.clip, "clip");
      throw new Error("the `clip` option is not supported yet.");
    }
    const omitBackground = validateBoolean(
      options.omitBackground,
      "omitBackground"
    );
    validateEnum(options.caret, "caret", ["hide", "initial"]);
    const animations = validateEnum(options.animations, "animations", [
      "disabled",
      "allow",
    ]);
    const scale = validateEnum(options.scale, "scale", ["css", "device"]);
    const mask = validateMask(options.mask);
    if (options.maskColor !== undefined)
      validateString(options.maskColor, "maskColor");
    const style =
      options.style === undefined ? "" : validateString(options.style, "style");
    if (fullPage) throw new Error("`fullPage: true` is not supported yet.");
    if (mask.length) throw new Error("the `mask` option is not supported yet.");
    if (style) throw new Error("the `style` option is not supported yet.");
    if (animations === "disabled")
      throw new Error('`animations: "disabled"` is not supported yet.');
    return validateEncoding(type, quality, omitBackground, scale);
  });
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

/** The steps of one capture, run in the window's queue. */
export type CaptureTask = {
  apiName: string;
  window: Window & typeof globalThis;
  encoding: ScreenshotEncoding;
  /** The resolved timeout; 0 waits without a limit. */
  timeout: number;
  /** The caller's signal bound to the page's lifetime. */
  signal: AbortSignal;
  /** The first call log line, such as `taking page screenshot`. */
  title: string;
  /** Pinned `previewNode`, naming an element a capture refuses. */
  describe: (element: Element) => string;
  /** Resolves the document rectangle to capture, once fonts are ready. */
  region: () => DocumentRect;
};

/** The pending work of each window's capture queue. */
const queues = new WeakMap<Window, Promise<unknown>>();

/**
 * Runs `task` once the window's earlier captures have finished, and settles
 * with its bytes, or rejects when the deadline passes or `signal` aborts.
 */
export function capture(task: CaptureTask): Promise<Uint8Array> {
  const log: string[] = [];
  // Aborted once the caller stops waiting, for whatever reason.
  const stop = new AbortController();
  const { signal } = task;
  if (signal.aborted) return Promise.reject(aborted(signal, log, false));
  const previous = queues.get(task.window) ?? Promise.resolve();
  const work = previous.then(() =>
    stop.signal.aborted ? undefined : run(task, log, stop.signal)
  );
  // The queue continues once this capture's own work has ended, however its
  // caller fared, so no two captures ever overlap in one window.
  queues.set(
    task.window,
    work.then(
      () => {},
      () => {}
    )
  );
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
      (error: unknown) => settle(() => reject(error))
    );
  });
}

/** The queued capture: fonts, region, renderer, checks and encoding. */
async function run(
  task: CaptureTask,
  log: string[],
  stopped: AbortSignal
): Promise<Uint8Array | undefined> {
  const cancelled = () => stopped.aborted;
  const { window: browserWindow, encoding } = task;
  const document = browserWindow.document;
  log.push(task.title);
  // Pinned `_preparePageForScreenshot` waits for `document.fonts.ready` and
  // ignores its rejection. A cancelled call stops waiting at once, so a
  // stalled font never holds the queue for a later capture.
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
  const region = task.region();
  const usedFonts = assertCapturableContent(task, region);
  const renderer = await loadRenderer();
  if (cancelled()) return undefined;
  const dpr = encoding.scale === "css" ? 1 : browserWindow.devicePixelRatio;
  // Rendered without a fill, so the page's own background shows through;
  // `compose` paints the canvas background the browser would paint under it.
  let result: Awaited<ReturnType<Renderer>>;
  let rendered: HTMLCanvasElement;
  let svg = "";
  try {
    result = await renderer(document.documentElement, {
      clip: region,
      dpr,
      scale: 1,
      backgroundColor: null,
      cache: "disabled",
      invalidate: true,
      plugins: [
        {
          name: "playwright-lite-embedded-fonts",
          afterRender: (context) => {
            svg = context.svgString ?? "";
          },
        },
      ],
    });
    rendered = await result.toCanvas();
  } catch (error) {
    throw withMessagePrefix(error, task.apiName);
  } finally {
    removeRendererScaffolding(document);
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
  const output = compose(browserWindow, rendered, encoding);
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
}

/**
 * SnapDOM leaves the hidden `<iframe>` it decodes images in attached to the
 * document after a capture, and removes its style sandbox only when a capture
 * succeeds. The queue runs one renderer per document at a time, so once one
 * settles, neither is in use; SnapDOM creates them again when it needs them.
 */
function removeRendererScaffolding(document: Document) {
  for (const element of document.querySelectorAll(
    "iframe[data-snapdom-internal], #snapdom-sandbox[data-snapdom-internal]"
  ))
    element.remove();
}

/**
 * Paints the canvas background, then the rendered document. The browser
 * starts from white, which `omitBackground` makes transparent for every type
 * but JPEG, and paints the root background, propagated from `<body>` when
 * `<html>` has none, over the whole canvas, beyond the root element's box.
 */
function compose(
  browserWindow: Window & typeof globalThis,
  rendered: HTMLCanvasElement,
  encoding: ScreenshotEncoding
): HTMLCanvasElement {
  const document = browserWindow.document;
  const output = document.createElement("canvas");
  output.width = rendered.width;
  output.height = rendered.height;
  const context = output.getContext("2d")!;
  if (!encoding.omitBackground || encoding.format === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
  }
  const rootColor = rootBackgroundColor(browserWindow);
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
 * Refuses a capture whose region holds content the renderer would replace
 * without reporting it: a canvas the page cannot read back, and the media
 * whose failures SnapDOM substitutes silently (frames, video, URL images in
 * CSS and SVG), which cannot yet be verified. `<img>` failures are reported
 * by the renderer itself.
 */
/**
 * Refuses content in `region` the renderer cannot reproduce or would replace
 * without a warning, and returns the web fonts its text uses: the family the
 * capture must embed, by lowercase name, and the first element that uses it.
 */
function assertCapturableContent(
  task: CaptureTask,
  region: DocumentRect
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
    if (
      !intersects(region, {
        x: box.left + browserWindow.scrollX,
        y: box.top + browserWindow.scrollY,
        width: box.width,
        height: box.height,
      })
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
function validateMask(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error(`mask: expected array, got ${typeof value}`);
  return value;
}
