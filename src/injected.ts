import {
  InjectedScript,
  parseAriaSnapshot,
} from "virtual:playwright-lite-injected";

export const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

const injectedScripts = new WeakMap<
  Window,
  { testIdAttributeName: string; injectedScript: InjectedScript }
>();

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
      customEngines: [],
      frameSeq: 0,
      isUnderTest: false,
      isUtilityWorld: false,
      sdkLanguage: "javascript",
      shouldPrependErrorPrefix: false,
      stableRafCount: 0,
      testIdAttributeName,
    });
    entry = { testIdAttributeName, injectedScript };
    injectedScripts.set(browserWindow, entry);
  }
  return entry.injectedScript;
}

export function parseAriaExpectation(value: string): unknown {
  return parseAriaSnapshot(value);
}
