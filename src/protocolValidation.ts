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

export function validateInteger(value: unknown, name: string): number {
  const integer = value instanceof Number ? value.valueOf() : value;
  if (typeof integer !== "number")
    throw new Error(`${name}: expected integer, got ${typeof value}`);
  if (!Number.isInteger(integer))
    throw new Error(`${name}: expected integer, got float ${integer}`);
  return integer;
}

/**
 * `delay` is `float?` in the pinned protocol for press, type and the pointer
 * actions. Like the pointer options, a non-finite value is rejected instead of
 * reaching the input path as NaN, and a boxed `Number` is unwrapped for the
 * caller to forward instead of leaking an object into the input path.
 */
export function validateDelay(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const delay = value instanceof Number ? value.valueOf() : value;
  if (typeof delay !== "number" || !Number.isFinite(delay))
    throw new TypeError("delay: expected number");
  return delay;
}

/**
 * `signal` is a client-side option in the pinned API: it never reaches the
 * protocol, so the adapter checks the value itself. `name` is the API member
 * or option group the message speaks for, such as `click` or `Query`.
 */
export function validateSignal(name: string, value: unknown): void {
  if (value === undefined || value instanceof AbortSignal) return;
  throw new TypeError(`${name} signal must be an AbortSignal`);
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
