import { afterEach, beforeEach, vi } from "vitest";

/**
 * The vitest runner reports a window error as an unhandled test error only
 * while no other `error` listener is registered. Tests that dispatch errors
 * after the page has unsubscribed keep one registered meanwhile.
 */
export function swallowWindowErrors() {
  const swallow = () => {};
  beforeEach(() => window.addEventListener("error", swallow));
  afterEach(() => {
    window.removeEventListener("error", swallow);
    vi.restoreAllMocks();
  });
}

/**
 * The listener-failure diagnostics the page logs, told apart from the runner's
 * own logging of the dispatched window error by their `page.on(...)` prefix.
 */
export const listenerFailures = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(
    ([message]) => typeof message === "string" && message.startsWith("page.on(")
  );
