import { MutationObserver } from "virtual:playwright-lite-globals";

const DOCUMENT_FRAGMENT_NODE = 11;

/**
 * An element Chromium forgets the moment it or one of its ancestors, across
 * shadow roots, is removed from its tree, as its `NodeWillBeRemoved` hooks
 * do. Removals are observed while the element is set and applied before it
 * is read, which catches an element that is added back before then.
 */
export class RemovalWatch {
  private target: Element | undefined;
  private readonly removals = new MutationObserver((records) =>
    this.apply(records)
  );

  /** The element, or `undefined` once it has been removed. */
  get element(): Element | undefined {
    this.apply(this.removals.takeRecords());
    return this.target;
  }

  set element(element: Element | undefined) {
    this.target = element;
    this.observe();
  }

  /** The removals observed and not yet applied. */
  takeRecords(): MutationRecord[] {
    return this.removals.takeRecords();
  }

  /** Forgets the element when one of `records`, except the one at `skip`, removed it. */
  apply(records: MutationRecord[], skip = -1) {
    const target = this.target;
    if (!target) return;
    for (let r = 0; r < records.length; r++)
      if (r !== skip)
        for (let i = 0; i < records[r]!.removedNodes.length; i++)
          if (containsComposed(records[r]!.removedNodes[i]!, target)) {
            this.element = undefined;
            return;
          }
  }

  /** Observes each tree from the element up to the document. */
  observe() {
    this.removals.disconnect();
    // Each tree on the element's way up to the document, since a document
    // observer does not see into shadow trees.
    for (let root = this.target?.getRootNode(); root;) {
      this.removals.observe(root, { childList: true, subtree: true });
      root =
        root.nodeType === DOCUMENT_FRAGMENT_NODE
          ? (root as ShadowRoot).host.getRootNode()
          : undefined;
    }
  }
}

/** Whether `node` is `target` or one of its ancestors across shadow roots. */
function containsComposed(node: Node, target: Node): boolean {
  for (let at: Node | null = target; at; at = parentComposed(at))
    if (at === node) return true;
  return false;
}

function parentComposed(node: Node): Node | null {
  return node.nodeType === DOCUMENT_FRAGMENT_NODE
    ? (node as ShadowRoot).host
    : node.parentNode;
}
