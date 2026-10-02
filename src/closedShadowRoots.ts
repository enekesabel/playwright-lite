import { WeakMap } from "virtual:playwright-lite-globals";

/**
 * Closed shadow roots that an element action has targeted inside, by host.
 *
 * The page never hands out a closed root, but an element it hands over (a
 * custom selector engine's result, a handle) already reaches every root
 * enclosing it. Input follows those roots as the browser's own input does;
 * locators, ARIA snapshots and other page state never read them.
 */
const closedRoots = new WeakMap<Element, ShadowRoot>();

/** Records every closed root enclosing `element`, then returns it. */
export function learnClosedRoots<T extends Element>(element: T): T {
  for (
    let root = element.getRootNode();
    // Node types, not constructors: a page may delete its own globals.
    root.nodeType === 11 && (root as ShadowRoot).host;
    root = (root as ShadowRoot).host.getRootNode()
  ) {
    const shadow = root as ShadowRoot;
    if (shadow.mode === "closed") closedRoots.set(shadow.host, shadow);
  }
  return element;
}

/** The host's shadow root, open or recorded closed; `null` when out of reach. */
export function inputShadowRoot(host: Element): ShadowRoot | null {
  return host.shadowRoot ?? closedRoots.get(host) ?? null;
}
