import { afterEach } from "vitest";

import { PageImpl } from "../../src/page";

/**
 * Helpers for the contract tests that traverse or replace a document. A
 * document replacement would end the test's own realm, so those tests drive a
 * same-origin frame through a `Page` for the frame's window; same-document
 * traversals run in the test's own window.
 */

let frame: HTMLIFrameElement | undefined;

afterEach(() => {
  frame?.remove();
  frame = undefined;
});

/** Resolves once the frame's next document has loaded. */
function nextLoad(): Promise<void> {
  return new Promise((resolve) =>
    frame!.addEventListener(
      "load",
      // A navigation started before the load event ends replaces the entry,
      // so let the document finish loading first.
      () => setTimeout(resolve, 0),
      { once: true }
    )
  );
}

/** A `Page` for a same-origin frame whose session history holds `urls`. */
export async function framePage(...urls: string[]) {
  frame = document.createElement("iframe");
  const loaded = nextLoad();
  frame.src = urls[0];
  document.body.appendChild(frame);
  await loaded;
  for (const url of urls.slice(1)) {
    const next = nextLoad();
    frameWindow().location.assign(url);
    await next;
  }
  return { page: new PageImpl(frameWindow()), nextLoad, frameWindow };
}

function frameWindow() {
  return frame!.contentWindow! as Window & typeof globalThis;
}

/** Settles with "pending" if `promise` has not settled within `ms`. */
export function stateAfter(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected"
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

/** Holds the document at `readyState` "loading" until the returned restore. */
export function stubLoading(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "loading",
  });
  return () => {
    if (descriptor) Object.defineProperty(document, "readyState", descriptor);
    else delete (document as { readyState?: DocumentReadyState }).readyState;
  };
}

/**
 * Leaves a same-document entry on the given side of the current one and holds
 * the document loading, so a traversal commits and then waits for `load`.
 */
export async function prepareTraversal(side: "back" | "forward") {
  const url = location.href;
  history.pushState({}, "", "#traversal");
  if (side === "forward") {
    const traversed = new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true })
    );
    history.back();
    await traversed;
  }
  const restore = stubLoading();
  return () => {
    restore();
    history.replaceState({}, "", url);
  };
}
