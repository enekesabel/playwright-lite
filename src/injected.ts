import {
  InjectedScript,
  parseAriaSnapshot,
} from "virtual:playwright-lite-injected";
import { WeakMap, Error } from "virtual:playwright-lite-globals";

export const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

const injectedScripts = new WeakMap<
  Window,
  { testIdAttributeName: string; injectedScript: InjectedScript }
>();

/**
 * Engines `selectors.register()` accepted, in registration order. Pinned
 * server/dom.ts hands the same list to every InjectedScript it creates, each
 * source wrapped in parentheses so an object literal evaluates as one.
 */
const customEngines: { name: string; source: string }[] = [];

/**
 * Every InjectedScript created so far. Pinned Playwright only passes engines
 * to an InjectedScript it is creating, which there happens once per document;
 * here the one document keeps its InjectedScript, so a registered engine also
 * reaches the ones already created.
 */
const liveInjectedScripts = new Set<WeakRef<InjectedScript>>();

export function injectedScriptFor(
  root: Element,
  testIdAttributeName = DEFAULT_TEST_ID_ATTRIBUTE
) {
  const browserWindow = root.ownerDocument.defaultView;
  if (!browserWindow)
    throw new Error("Cannot capture ARIA state without a browser Window.");
  let entry = injectedScripts.get(browserWindow);
  if (!entry || entry.testIdAttributeName !== testIdAttributeName) {
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
    liveInjectedScripts.add(new WeakRef(injectedScript));
    entry = { testIdAttributeName, injectedScript };
    injectedScripts.set(browserWindow, entry);
  }
  return entry.injectedScript;
}

/**
 * Adds a selector engine to every InjectedScript, present and future. Each
 * live one evaluates the source exactly as the pinned constructor evaluates
 * its `customEngines`, in its own window. All evaluations run before any
 * engine is installed, so a source that throws registers nowhere.
 */
export function registerSelectorEngine(name: string, source: string): void {
  const engine = { name, source: `(${source})` };
  const evaluated: [InjectedScript, unknown][] = [];
  for (const reference of liveInjectedScripts) {
    const injectedScript = reference.deref();
    if (!injectedScript) liveInjectedScripts.delete(reference);
    else evaluated.push([injectedScript, injectedScript.eval(engine.source)]);
  }
  for (const [injectedScript, instance] of evaluated)
    injectedScript._engines.set(name, instance);
  customEngines.push(engine);
}

export function parseAriaExpectation(value: string): unknown {
  return parseAriaSnapshot(value);
}
