// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../build/playwright-injected.d.ts" />

import {
  InjectedScript,
  parseAriaSnapshot,
} from "virtual:ayme-playwright-injected";

export const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

declare const __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__: string | undefined;

const compiledTestIdAttribute =
  typeof __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__ === "string"
    ? __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__
    : DEFAULT_TEST_ID_ATTRIBUTE;

type TestIdConfiguredWindow = Window & {
  __aymeTestIdAttributeName?: unknown;
};

const injectedScripts = new WeakMap<
  Window,
  { testIdAttributeName: string; injectedScript: InjectedScript }
>();

export function testIdAttributeNameFor(browserWindow: Window): string {
  const testIdAttributeName = (browserWindow as TestIdConfiguredWindow)
    .__aymeTestIdAttributeName;
  return typeof testIdAttributeName === "string" && testIdAttributeName
    ? testIdAttributeName
    : compiledTestIdAttribute;
}

export function injectedScriptFor(root: Element) {
  const browserWindow = root.ownerDocument.defaultView;
  if (!browserWindow)
    throw new Error("Cannot capture ARIA state without a browser Window.");

  const testIdAttributeName = testIdAttributeNameFor(browserWindow);
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

/**
 * Parses a matcher template with the parser bundled in the pinned injected
 * artifact. This remains internal to expectation orchestration.
 */
export function parseAriaExpectation(value: string): unknown {
  return parseAriaSnapshot(value);
}
