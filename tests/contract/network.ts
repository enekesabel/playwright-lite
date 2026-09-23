import { afterEach } from "vitest";

/**
 * Helpers for the contract tests that observe the document's own `fetch`.
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

let delayed = 0;

/**
 * A same-origin GIF the contract server answers after `ms` milliseconds. The
 * last path segment is `name`, or a counter that keeps each URL unique so the
 * browser never reuses an earlier image.
 */
export const delayedUrl = (ms: number, name = String(delayed++)) =>
  contractUrl(`/__delay/${ms}/${name}`);

/**
 * The lower bound of a `networkidle` wait measured from the page: timers never
 * fire early, but the page may see a call end a moment before the observation
 * does.
 */
export const idleWindow = 490;

/** A same-origin asset the test server answers with 200 and a known type. */
export const assetUrl = (query = "") =>
  new URL(`/tests/assets/title.html${query}`, location.origin).href;

/** The `XMLHttpRequest` methods the network observation replaces. */
export const xhrMethods = () => ({
  open: XMLHttpRequest.prototype.open,
  setRequestHeader: XMLHttpRequest.prototype.setRequestHeader,
  send: XMLHttpRequest.prototype.send,
});

/**
 * Sends an `XMLHttpRequest` the way a Site would, and reports the event that
 * ended it, so a test can await the traffic instead of sleeping.
 */
export function sendXhr(
  url: string,
  init: {
    method?: string;
    headers?: [string, string][];
    body?: XMLHttpRequestBodyInit;
  } = {}
) {
  const xhr = new XMLHttpRequest();
  const ended = new Promise<string>((resolve) => {
    for (const event of ["load", "error", "abort", "timeout"] as const)
      xhr.addEventListener(event, () => resolve(event));
  });
  xhr.open(init.method ?? "GET", url);
  for (const [name, value] of init.headers ?? [])
    xhr.setRequestHeader(name, value);
  xhr.send(init.body ?? null);
  return { xhr, ended };
}
