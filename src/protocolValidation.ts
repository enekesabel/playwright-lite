import { Error, TypeError, Object } from "virtual:playwright-lite-globals";

/**
 * Client-boundary checks from the pinned Playwright protocol semantics.
 * See packages/protocol/src/validatorPrimitives.ts and spec/frame.yml at
 * 26a9e470a7b3c7822084b09fb7f13902c5f37b51.
 */
/** Pinned validatorPrimitives.ts `ValidationError`: a parameter failed its schema. */
export class ValidationError extends Error {}

export function validateString(value: unknown, name: string): string {
  if (value instanceof String) return value.valueOf();
  if (typeof value === "string") return value;
  throw new ValidationError(`${name}: expected string, got ${typeof value}`);
}

/**
 * Pinned channelOwner.ts `_wrapApiCall` prefixes every error with the API
 * name. The selector queries apply that prefix to a parameter validation
 * error, such as a non-string selector the shared resolver rejects.
 */
export async function withValidationPrefix<T>(
  apiName: string,
  run: () => T | Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ValidationError)
      error.message = `${apiName}: ${error.message}`;
    throw error;
  }
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
 * `force` is `boolean?` in the pinned protocol for every action that takes it.
 * Like the pointer options, a boxed `Boolean` is unwrapped so the caller
 * forwards a primitive instead of an always-truthy object.
 */
export function validateForce(
  method: string,
  value: unknown
): boolean | undefined {
  if (value === undefined) return undefined;
  const force = value instanceof Boolean ? value.valueOf() : value;
  if (typeof force !== "boolean")
    throw new TypeError(`${method} force must be a boolean`);
  return force;
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

/**
 * Rejects options the adapter does not implement, shared by the `Locator` and
 * `ElementHandle` forms of a member so both reject the same option with the
 * same message. Returns the normalized `delay`, unwrapped like the pointer
 * options.
 */
export function rejectUnsupportedOptions(
  method: string,
  options: Record<string, unknown> | undefined,
  supported: string[] = []
): number | undefined {
  if (!options) return undefined;
  const unsupported = Object.keys(options).filter(
    (key) => options[key] !== undefined && !supported.includes(key)
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${method}(): unsupported Playwright option(s): ${unsupported.join(", ")}.`
    );
  }
  validateSignal(method, options.signal);
  if (supported.includes("noWaitAfter"))
    validateNoWaitAfter(method, options.noWaitAfter);
  return supported.includes("delay") ? validateDelay(options.delay) : undefined;
}

/** Pinned validatorPrimitives.ts `tOptional(tBoolean)`, which unwraps a `Boolean`. */
export function validateBoolean(
  value: unknown,
  name: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Boolean) return value.valueOf();
  if (typeof value === "boolean") return value;
  throw new Error(`${name}: expected boolean, got ${typeof value}`);
}

export function validateNoWaitAfter(method: string, value: unknown): void {
  // Only click and press retain this field in the pinned protocol. Other
  // actions drop the deprecated no-op option, without validating its value.
  if (method !== "click" && method !== "press") return;
  validateBoolean(value, "noWaitAfter");
}
