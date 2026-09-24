/**
 * Helper for the contract tests that wait on the document's lifecycle state.
 */

/** Runs `run` while `document.readyState` reports `state`, then restores it. */
export async function withReadyState<T>(
  state: DocumentReadyState,
  run: () => Promise<T>
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: state,
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(document, "readyState", descriptor);
    else delete (document as { readyState?: DocumentReadyState }).readyState;
  }
}
