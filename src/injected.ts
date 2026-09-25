import {
  InjectedScript,
  parseAriaSnapshot,
} from "virtual:playwright-lite-injected";
import { Error, Map, WeakMap } from "virtual:playwright-lite-globals";

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
    entry = { engineCount: customEngines.length, injectedScript };
    byTestId.set(testIdAttributeName, entry);
  }
  return entry.injectedScript;
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
