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
 * source wrapped in parentheses so an object literal evaluates as one. A
 * function engine is kept as the function: it already lives in the page's
 * JavaScript world, the only one there is, so it is called rather than
 * evaluated from its source, and a Content Security Policy that forbids
 * `eval` does not stop it.
 */
type CustomEngine =
  { name: string; source: string } | { name: string; create: () => unknown };
const customEngines: CustomEngine[] = [];

/** Per window, one InjectedScript per test ID attribute. */
const injectedScripts = new WeakMap<
  Window,
  Map<string, { engineCount: number; injectedScript: InjectedScript }>
>();

/**
 * The InjectedScript for the window and test ID attribute, created again once
 * an engine was registered after it, so it always carries the current
 * `customEngines`.
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
      customEngines: [],
      frameSeq: 0,
      isUnderTest: false,
      isUtilityWorld: false,
      sdkLanguage: "javascript",
      shouldPrependErrorPrefix: false,
      stableRafCount: 0,
      testIdAttributeName,
    });
    // Each engine is installed in registration order, as the constructor
    // installs the evaluated ones: a source is evaluated as the constructor
    // would, a function is called as it is.
    for (const engine of customEngines)
      injectedScript._engines.set(
        engine.name,
        "source" in engine
          ? injectedScript.eval(engine.source)
          : engine.create()
      );
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
 * visible, the replacements call the window's functions as `timersFor` bound
 * them.
 */
function keepPaceWhileHidden(
  injectedScript: InjectedScript,
  browserWindow: Window & typeof globalThis
) {
  const timers = timersFor(browserWindow);
  // A new object, since pinned `UtilityScript` can hand out one it shares.
  injectedScript.utils.builtins = {
    ...injectedScript.utils.builtins,
    requestAnimationFrame: timers.requestAnimationFrame,
    cancelAnimationFrame: timers.cancelAnimationFrame,
  };
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
 * next `injectedScriptFor()` call creates one. Like Playwright, a source is
 * first evaluated there, and a function first called, so one that throws
 * fails that call.
 */
export function registerSelectorEngine(
  name: string,
  script: string | (() => unknown)
): void {
  customEngines.push(
    typeof script === "function"
      ? { name, create: script }
      : { name, source: `(${script})` }
  );
}

export function parseAriaExpectation(value: string): unknown {
  return parseAriaSnapshot(value);
}
