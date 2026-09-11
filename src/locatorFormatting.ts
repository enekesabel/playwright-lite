type LocatorChainStep = readonly [string, readonly unknown[]];

/** Formats facade labels, preserving custom description precedence. */
export function formatLocatorDescription(
  label: string,
  description?: string
): string {
  if (description) return description;
  return label
    .replace(/^page\./, "")
    .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_, encoded: string) =>
      quoteString(JSON.parse(`"${encoded}"`))
    );
}

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
