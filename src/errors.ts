/**
 * A browser-runtime timeout that remains recognizable without importing
 * Playwright's Node-side error classes. The global symbol is deliberately
 * stable across independently compiled copies of this package.
 */
export const ADAPTER_TIMEOUT_ERROR = Symbol.for(
  "ayme:playwright-browser:TimeoutError"
);

export class AdapterTimeoutError extends Error {
  readonly [ADAPTER_TIMEOUT_ERROR] = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TimeoutError";
  }
}

export function isAdapterTimeoutError(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[ADAPTER_TIMEOUT_ERROR] === true
  );
}
