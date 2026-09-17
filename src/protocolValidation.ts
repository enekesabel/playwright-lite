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

/**
 * `delay` is `float?` in the pinned protocol for press, type and the pointer
 * actions. Like the pointer options, a non-finite value is rejected instead of
 * reaching the input path as NaN.
 */
export function validateDelay(value: unknown): void {
  if (value === undefined) return;
  const delay = value instanceof Number ? value.valueOf() : value;
  if (typeof delay !== "number" || !Number.isFinite(delay))
    throw new TypeError("delay: expected number");
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
