// Proposed capture coordination for screenshot issue #255. Design probe only:
// this is not production code and nothing in src/ imports it.
//
// One coordinator per window is shared by every Page instance of one package
// copy, like src/hostGlobals.ts `perWindow`. It owns three things:
//
// 1. A FIFO lease. Only the lease holder may apply temporary preparation or
//    run SnapDOM's clone stage, because the pinned preparation and SnapDOM's
//    own live mutations are not reentrant within one document.
// 2. The renderers it started, so a canceled one stays observed and its late
//    result is dropped.
// 3. Cleanup of SnapDOM scaffolding left in the document when a canceled
//    renderer stops before SnapDOM's own removal runs.

const coordinators = new WeakMap();

/** The document's coordinator, created on first use (src/hostGlobals.ts `perWindow`). */
export function coordinatorFor(browserWindow) {
  let coordinator = coordinators.get(browserWindow);
  if (!coordinator)
    coordinators.set(
      browserWindow,
      (coordinator = new CaptureCoordinator(browserWindow))
    );
  return coordinator;
}

export class CaptureCanceled extends Error {
  constructor(stage) {
    super(`capture canceled before ${stage}`);
    this.name = "CaptureCanceled";
    this.stage = stage;
  }
}

class CaptureCoordinator {
  #window;
  #waiters = [];
  #holder = null;
  #renderers = new Set();
  #sequence = 0;

  constructor(browserWindow) {
    this.#window = browserWindow;
  }

  get holder() {
    return this.#holder?.id ?? null;
  }

  get pendingRenderers() {
    return this.#renderers.size;
  }

  /**
   * Resolves with a lease once every earlier holder has released. A waiter
   * whose signal aborts leaves the queue and rejects with the abort reason.
   */
  acquire(signal, label) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, label, onAbort: null };
      waiter.onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) this.#waiters.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.#waiters.push(waiter);
      this.#grant();
    });
  }

  release(lease) {
    if (lease.released) return;
    lease.released = true;
    if (this.#holder === lease) this.#holder = null;
    // Between leases no clone stage is running, and SnapDOM only touches its
    // default-style sandbox synchronously inside that stage.
    if (this.#renderers.size === 0) removeScaffolding(this.#window.document);
    else removeSandbox(this.#window.document);
    this.#grant();
  }

  /** Keeps `renderer` observed; its late value or error goes nowhere. */
  track(renderer) {
    this.#renderers.add(renderer);
    renderer.then(
      () => this.#settled(renderer),
      () => this.#settled(renderer)
    );
    return renderer;
  }

  #settled(renderer) {
    this.#renderers.delete(renderer);
    // SnapDOM's export decode frame is reused across exports; remove it only
    // when no renderer of this document can be using it.
    if (this.#renderers.size === 0 && this.#holder === null)
      removeScaffolding(this.#window.document);
  }

  #grant() {
    if (this.#holder !== null) return;
    const waiter = this.#waiters.shift();
    if (!waiter) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    const lease = {
      id: `${waiter.label}#${++this.#sequence}`,
      released: false,
    };
    this.#holder = lease;
    waiter.resolve(lease);
  }
}

/**
 * SnapDOM 3.2.0 creates `#snapdom-sandbox` in document.body while cloning
 * (utils/css.js getDefaultStyleForTag) and removes it only at the end of
 * engines/svg.js composeAndSerialize, without a finally. A renderer stopped
 * earlier leaves it behind. Its private WeakSet is not reachable, so the
 * sandbox is recognized by the attributes markInternalNode sets.
 */
function removeSandbox(document) {
  for (const node of document.querySelectorAll(
    "#snapdom-sandbox[data-snapdom-sandbox][data-snapdom-internal]"
  ))
    if (node.childElementCount === 0) node.remove();
}

function removeScaffolding(document) {
  removeSandbox(document);
  for (const node of document.querySelectorAll(
    "body > iframe[data-snapdom-internal][aria-hidden='true']"
  ))
    node.remove();
}

/**
 * The lifetime of one Page instance: src/lifetime.ts `PageLifetime`, reduced
 * to what the probe needs. Closing aborts with the pinned TargetClosedError
 * message.
 */
export class Lifetime {
  #controller = new AbortController();

  get signal() {
    return this.#controller.signal;
  }

  close() {
    const error = new Error("Target page, context or browser has been closed");
    error.name = "TargetClosedError";
    this.#controller.abort(error);
  }
}

/**
 * One call's cancellation: the caller's signal, the Page closing and the
 * deadline, combined like src/lifetime.ts `bind` plus the action deadline in
 * src/page.ts.
 */
export class Operation {
  constructor(lifetime, timeout, callerSignal) {
    this.timeout = timeout;
    this.deadline = new AbortController();
    this.timer =
      timeout > 0
        ? setTimeout(() => {
            const error = new Error(`Timeout ${timeout}ms exceeded.`);
            error.name = "TimeoutError";
            this.deadline.abort(error);
          }, timeout)
        : undefined;
    const signals = [lifetime.signal, this.deadline.signal];
    if (callerSignal) signals.push(callerSignal);
    this.signal = AbortSignal.any(signals);
  }

  /**
   * Settles like `promise` or rejects with the abort reason, whichever is
   * first (src/lifetime.ts `race`). A losing promise stays observed.
   */
  race(promise) {
    const signal = this.signal;
    promise.catch(() => {});
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  dispose() {
    clearTimeout(this.timer);
  }
}

/**
 * Pinned server/screenshotter.ts `inPagePrepareForScreenshots` (Apache-2.0,
 * commit 26a9e470a7b3c7822084b09fb7f13902c5f37b51), style and caret parts.
 * The pinned function stores its cleanup in the single
 * `window.__pwCleanupScreenshot` slot; here it returns the cleanup instead,
 * because Page instances share the window.
 */
export function prepareForScreenshot(
  screenshotStyle,
  hideCaret,
  { exactAttributes = true } = {}
) {
  const cleanupCallbacks = [];
  if (screenshotStyle || hideCaret) {
    const roots = collectRoots(document);
    if (screenshotStyle) {
      for (const root of roots) {
        const styleTag = document.createElement("style");
        styleTag.textContent = screenshotStyle;
        if (root === document) document.documentElement.append(styleTag);
        else root.append(styleTag);
        cleanupCallbacks.push(() => styleTag.remove());
      }
    }
    if (hideCaret) {
      const elements = new Map();
      for (const root of roots) {
        root
          .querySelectorAll("input,textarea,[contenteditable]")
          .forEach((element) => {
            elements.set(element, {
              value: element.style.getPropertyValue("caret-color"),
              priority: element.style.getPropertyPriority("caret-color"),
              attribute: element.getAttribute("style"),
              cssText: element.style.cssText,
            });
            element.style.setProperty(
              "caret-color",
              "transparent",
              "important"
            );
          });
      }
      cleanupCallbacks.push(() => {
        for (const [element, value] of elements) {
          element.style.setProperty("caret-color", value.value, value.priority);
          // The pinned restore is exact in CSSOM terms, but it re-serializes
          // the style attribute and leaves style="" where there was none.
          // Put the attribute text back unless the page changed the inline
          // style meanwhile.
          if (!exactAttributes || element.style.cssText !== value.cssText)
            continue;
          if (value.attribute === null) element.removeAttribute("style");
          else if (element.getAttribute("style") !== value.attribute)
            element.setAttribute("style", value.attribute);
        }
      });
    }
  }
  let restored = false;
  return () => {
    if (restored) return false;
    restored = true;
    for (const cleanup of cleanupCallbacks) cleanup();
    return true;
  };
}

function collectRoots(root, roots = []) {
  roots.push(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  do {
    const node = walker.currentNode;
    const shadowRoot = node instanceof Element ? node.shadowRoot : null;
    if (shadowRoot) collectRoots(shadowRoot, roots);
  } while (walker.nextNode());
  return roots;
}

/**
 * A SnapDOM plugin that makes a canceled capture stop at the next stage
 * boundary. SnapDOM 3.2.0 awaits every hook without catching (core/plugins.js
 * runHook/runAll), so a throw ends its pipeline. `resolveNode` errors are
 * swallowed by core/clone.js, so the clone walk itself cannot be stopped.
 */
export function cancellationPlugin(token, root, record, extra = {}) {
  // SnapDOM rasterizes a same-origin iframe with a nested capture that reuses
  // these plugins (utils/clone.helpers.js rasterizeIframe), inside the outer
  // clone stage. Only the outer capture ends the clone stage.
  const at = (stage, context) => {
    const outer = context.element === root;
    record(outer ? stage : `${stage} (nested)`);
    extra[stage]?.(context, outer);
    if (token.canceled) throw new CaptureCanceled(stage);
  };
  return {
    name: "playwright-lite-capture",
    beforeSnap: (context) => at("beforeSnap", context),
    beforeClone: (context) => at("beforeClone", context),
    afterClone: (context) => {
      // SnapDOM's own live mutations (line clamp, layout stabilisation,
      // content-visibility, iframe viewport pinning) are undone before the
      // outer capture's hook runs.
      if (context.element === root) {
        token.cloneSettled = true;
        token.resolveClone();
      }
      at("afterClone", context);
    },
    beforeRender: (context) => at("beforeRender", context),
    afterRender: (context) => at("afterRender", context),
    beforeExport: (context) => at("beforeExport", context),
    afterExport: (context) => at("afterExport", context),
  };
}

export function createToken() {
  const token = { canceled: false, cloneSettled: false };
  token.cloneDone = new Promise((resolve) => (token.resolveClone = resolve));
  return token;
}
