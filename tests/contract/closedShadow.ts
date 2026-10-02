import { selectors } from "../../src/index";

/**
 * The contract tests' closed shadow roots. Locators never enter a closed
 * root, so the `closed` selector engine hands an element inside one to the
 * adapter by its id, as a page's own engine can.
 */

declare global {
  interface Window {
    closedShadowElements?: Map<string, Element>;
  }
}

const engineSource = `({
  query(root, id) { return window.closedShadowElements?.get(id) ?? null; },
  queryAll(root, id) {
    const element = window.closedShadowElements?.get(id);
    return element ? [element] : [];
  },
})`;

let registered: Promise<void> | undefined;

/**
 * Replaces the body with `<div id=host>` holding `depth` closed roots, each
 * nested in a `div` of the one before, the innermost with `html` in it. Its
 * elements with an id resolve through `closed=<id>`.
 */
export async function closedShadow(
  html: string,
  { depth = 1, delegatesFocus = false } = {}
): Promise<{ host: HTMLElement; roots: ShadowRoot[] }> {
  registered ??= selectors.register("closed", engineSource);
  await registered;
  document.body.innerHTML = "<div id=host></div>";
  const host = document.querySelector<HTMLElement>("#host")!;
  const roots = [host.attachShadow({ mode: "closed", delegatesFocus })];
  for (let level = 1; level < depth; level++) {
    const nested = document.createElement("div");
    nested.id = `host${level + 1}`;
    roots.at(-1)!.append(nested);
    roots.push(nested.attachShadow({ mode: "closed", delegatesFocus }));
  }
  roots.at(-1)!.innerHTML = html;
  window.closedShadowElements = new Map(
    roots.flatMap((root) =>
      Array.from(root.querySelectorAll("[id]"), (element) => [
        element.id,
        element,
      ])
    )
  );
  return { host, roots };
}
