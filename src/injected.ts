import {
  InjectedScript,
  parseAriaSnapshot,
} from "virtual:playwright-lite-injected";
import { Error, Map, Promise, WeakMap } from "virtual:playwright-lite-globals";

import { layoutViewportRatio } from "./layoutViewportRatio";
import { timersFor } from "./timers";

export const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

/**
 * Engines `selectors.register()` accepted, in registration order. Pinned
 * server/dom.ts hands the same list to every InjectedScript it creates, each
 * source wrapped in parentheses so an object literal evaluates as one.
 */
const customEngines: { name: string; source: string }[] = [];

/** Per window, one InjectedScript per test ID attribute. */
const injectedScripts = new WeakMap<
  Window,
  Map<string, { engineCount: number; injectedScript: InjectedScript }>
>();

/**
 * The InjectedScript for the window and test ID attribute, created again once
 * an engine was registered after it, so the pinned constructor always
 * evaluates the current `customEngines`.
 */
export function injectedScriptFor(
  root: Element,
  testIdAttributeName = DEFAULT_TEST_ID_ATTRIBUTE
) {
  const browserWindow = root.ownerDocument.defaultView;
  if (!browserWindow)
    throw new Error("Cannot capture ARIA state without a browser Window.");
  let byTestId = injectedScripts.get(browserWindow);
  if (!byTestId) {
    byTestId = new Map();
    injectedScripts.set(browserWindow, byTestId);
  }
  let entry = byTestId.get(testIdAttributeName);
  if (!entry || entry.engineCount !== customEngines.length) {
    const injectedScript = new InjectedScript(browserWindow, {
      browserName: "chromium",
      customEngines: [...customEngines],
      frameSeq: 0,
      isUnderTest: false,
      isUtilityWorld: false,
      sdkLanguage: "javascript",
      shouldPrependErrorPrefix: false,
      stableRafCount: 0,
      testIdAttributeName,
    });
    keepPaceWhileHidden(injectedScript, browserWindow);
    // The replaced InjectedScript owns the highlight overlay it drew, which
    // the new one cannot remove, so it takes the overlay down first.
    entry?.injectedScript.hideHighlight();
    entry = { engineCount: customEngines.length, injectedScript };
    byTestId.set(testIdAttributeName, entry);
  }
  return entry.injectedScript;
}

/**
 * Lets the pinned InjectedScript keep its pace in a hidden document, where the
 * browser stops animation frames: its stability check, highlight and
 * `viewportRatio` read their frames from `utils.builtins`, which pinned
 * `UtilityScript` binds to the window's own functions. While the document is
 * visible, the replacements call those same functions.
 */
function keepPaceWhileHidden(
  injectedScript: InjectedScript,
  browserWindow: Window & typeof globalThis
) {
  const timers = timersFor(browserWindow);
  const { builtins } = injectedScript.utils;
  builtins.requestAnimationFrame = timers.requestAnimationFrame;
  builtins.cancelAnimationFrame = timers.cancelAnimationFrame;
  // Pinned `viewportRatio` waits for an IntersectionObserver report, which
  // only comes with a rendering update. A hidden document gets none, so the
  // ratio is read from layout there, also when the document is hidden while
  // the report is pending.
  const observedRatio = injectedScript.viewportRatio.bind(injectedScript);
  injectedScript.viewportRatio = (element) => {
    if (browserWindow.document.visibilityState === "hidden")
      return Promise.resolve(layoutViewportRatio(element));
    return new Promise((resolve, reject) => {
      const stop = timers.onHidden(() => resolve(layoutViewportRatio(element)));
      observedRatio(element).then(resolve, reject).finally(stop);
    });
  };
}

/**
 * Adds a selector engine for every InjectedScript created from now on; the
 * next `injectedScriptFor()` call creates one. Like Playwright, the source is
 * first evaluated there, so a source that throws fails that call.
 */
export function registerSelectorEngine(name: string, source: string): void {
  customEngines.push({ name, source: `(${source})` });
}

export function parseAriaExpectation(value: string): unknown {
  return parseAriaSnapshot(value);
}
