/**
 * Node-side `Locator.description()` and `toString()` for the bridge's locator
 * proxy. Both are synchronous in Playwright's API, so the bridge cannot ask the
 * browser adapter for them; it formats the recorded chain instead. Upstream
 * tests that assert these members therefore never execute the adapter and stay
 * diagnostic; the adapter's own `description()` and `toString()` are covered by
 * `tests/contract/description.test.ts` and `tests/contract/toString.test.ts`.
 */
type LocatorChainStep = readonly [string, readonly unknown[]];

export function locatorDescription(description?: string): string | null {
  return description ?? null;
}

export function formatLocatorChainDescription(
  chain: readonly LocatorChainStep[],
  description?: string
): string {
  if (description) return description;
  return (
    chain
      .map(([method, args]) => `${method}(${args.map(formatValue).join(", ")})`)
      .join(".") || "locator(...)"
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return quoteString(value);
  if (
    value !== null &&
    typeof value === "object" &&
    value.toString === Object.prototype.toString
  ) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${key}: ${formatValue(entry)}`);
    return entries.length ? `{ ${entries.join(", ")} }` : "{}";
  }
  return String(value);
}

function quoteString(value: string): string {
  const encoded = JSON.stringify(value);
  return `'${encoded.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}
