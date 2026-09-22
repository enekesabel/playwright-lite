import { afterEach } from "vitest";

/**
 * Helpers for the contract tests that observe the document's own `fetch`.
 * Every test restores `window.fetch` itself, so a failing assertion cannot
 * leave the wrapper behind for the next file.
 */

/** Restores `window.fetch` to whatever the suite started with. */
export function restoreFetch() {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });
}

/** A same-origin URL that answers, used where only the URL matters. */
export const contractUrl = (path: string) => new URL(path, location.href).href;

/**
 * Replaces `window.fetch` with a recorded stand-in before the page wraps it,
 * so a test can read what the wrapper forwarded without a controllable server.
 */
export function recordedFetch(body = "ok", init?: ResponseInit) {
  const calls: Request[] = [];
  window.fetch = ((input: RequestInfo | URL) => {
    calls.push(input as Request);
    return Promise.resolve(new Response(body, init));
  }) as typeof fetch;
  return calls;
}
