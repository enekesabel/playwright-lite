import { afterEach } from "vitest";

/**
 * The contract tests' touch-capable document. Chromium reports
 * `navigator.maxTouchPoints` above 0 only when touch is emulated or present,
 * and the test browser has neither, so a test that taps reports one touch
 * point on `navigator` until it ends.
 */

afterEach(() => {
  withoutTouch();
});

export function emulateTouch(): () => void {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 1,
  });
  return withoutTouch;
}

function withoutTouch() {
  Reflect.deleteProperty(navigator, "maxTouchPoints");
}
