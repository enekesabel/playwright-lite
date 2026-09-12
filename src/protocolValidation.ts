/**
 * Client-boundary checks from the pinned Playwright protocol semantics.
 * See packages/protocol/src/validatorPrimitives.ts and spec/frame.yml at
 * 26a9e470a7b3c7822084b09fb7f13902c5f37b51.
 */
export function validateString(value: unknown, name: string): string {
  if (value instanceof String) return value.valueOf();
  if (typeof value === "string") return value;
  throw new Error(`${name}: expected string, got ${typeof value}`);
}

export function validateNoWaitAfter(method: string, value: unknown): void {
  // Only click and press retain this field in the pinned protocol. Other
  // actions drop the deprecated no-op option, without validating its value.
  if (method !== "click" && method !== "press") return;
  if (
    value === undefined ||
    typeof value === "boolean" ||
    value instanceof Boolean
  )
    return;
  throw new Error(`noWaitAfter: expected boolean, got ${typeof value}`);
}
