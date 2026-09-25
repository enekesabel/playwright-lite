/**
 * The lifetime of one `Page` instance `createPage()` returned, which
 * `page.close()` ends. Closing disposes the instance, not the document: the
 * document stays open, and only what the instance installed on the host is
 * released.
 */

/** Pinned client/errors.ts `TargetClosedError` default message. */
export const TARGET_CLOSED_MESSAGE =
  "Target page, context or browser has been closed";

const TARGET_CLOSED_ERROR = Symbol.for("playwright-lite:TargetClosedError");

/**
 * Pinned client/errors.ts `TargetClosedError`: a plain `Error` by name, since
 * the pinned class sets none. The global brand keeps it recognizable across
 * independently compiled copies of this package, as `AdapterTimeoutError` is.
 */
export class TargetClosedError extends Error {
  readonly [TARGET_CLOSED_ERROR] = true;
  /** The message without an API name: the close reason or the default. */
  readonly reason: string;

  constructor(reason?: string) {
    super(reason || TARGET_CLOSED_MESSAGE);
    this.reason = this.message;
  }
}

/**
 * Pinned client methods prefix an error with the member that raised it. An
 * `AbortError` is prefixed once; the closed error is re-prefixed from its
 * reason, so the outermost member's name is the one reported.
 */
export function prefixApiError(error: unknown, apiName: string): unknown {
  if (isTargetClosedError(error)) error.message = `${apiName}: ${error.reason}`;
  else if (error instanceof Error && error.name === "AbortError")
    error.message = `${apiName}: ${error.message}`;
  return error;
}

export function isTargetClosedError(
  value: unknown
): value is TargetClosedError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TARGET_CLOSED_ERROR] === true
  );
}

export class PageLifetime {
  private readonly controller = new AbortController();
  private isClosed = false;

  get closed(): boolean {
    return this.isClosed;
  }

  /**
   * Aborts once the page has closed, with a `TargetClosedError` carrying the
   * close reason as its abort reason.
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * A call's own `signal` combined with the page's closure, so every wait
   * that honours a signal also ends when the page closes. A value that is not
   * an `AbortSignal` is returned unchanged for the caller's validation to
   * reject.
   */
  bind(signal: AbortSignal | undefined): AbortSignal {
    if (signal === undefined) return this.controller.signal;
    if (!(signal instanceof AbortSignal)) return signal;
    return AbortSignal.any([signal, this.controller.signal]);
  }

  /**
   * Ends the lifetime once; a later call does nothing. Calls are refused from
   * the start of `announce`, which reports the closure, and pending waits are
   * aborted after it, so a wait for the `close` event itself still resolves.
   */
  close(reason: string | undefined, announce: () => void): void {
    if (this.isClosed) return;
    this.isClosed = true;
    try {
      announce();
    } finally {
      this.controller.abort(new TargetClosedError(reason));
    }
  }

  /** The error of a call the closure interrupted, carrying the close reason. */
  interruption(): TargetClosedError {
    return new TargetClosedError(
      (this.controller.signal.reason as TargetClosedError).reason
    );
  }

  /**
   * Settles like `promise`, or rejects with the closure's error once the page
   * closes first. For work no signal can stop, such as a page function. A
   * `promise` that loses stays observed, so its later rejection is not
   * reported as unhandled.
   */
  race<T>(promise: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    if (signal.aborted) {
      promise.catch(() => {});
      return Promise.reject(this.interruption());
    }
    return new Promise<T>((resolve, reject) => {
      const onClose = () => reject(this.interruption());
      signal.addEventListener("abort", onClose, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onClose);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onClose);
          reject(error);
        }
      );
    });
  }
}

/**
 * The members of `T` that the Playwright interface `Api` declares and that
 * return a promise: the calls a closed page refuses. Sync members such as
 * `url()`, `locator()` or `on()` keep working after close, as in Playwright,
 * where they never reach the browser.
 */
export type LifetimeCalls<T, Api> = {
  [K in keyof T & keyof Api & string]: T[K] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? K
    : never;
}[keyof T & keyof Api & string];

/**
 * Makes each named method of `prototype` a call within its page's lifetime:
 * after `close()` it rejects with the default closed message, as the pinned
 * dispatcher answers a call on a disposed object whatever the close reason,
 * and an error the closure caused (carrying the reason) is reported under the
 * call's API name.
 *
 * `calls` is a record rather than a list so its type can require every member
 * `LifetimeCalls` selects: a new async member cannot be left unguarded.
 */
export function guardLifetimeCalls<T extends object>(
  prototype: T,
  calls: Record<string, true>,
  apiOwner: string | ((target: T) => string),
  lifetimeOf: (target: T) => PageLifetime
): void {
  const methods = prototype as Record<string, unknown>;
  for (const name of Object.keys(calls)) {
    const call = methods[name] as (...args: unknown[]) => Promise<unknown>;
    if (typeof call !== "function")
      throw new TypeError(`${name} is not a method to guard`);
    Object.defineProperty(prototype, name, {
      configurable: true,
      writable: true,
      value: async function (this: T, ...args: unknown[]) {
        const owner = typeof apiOwner === "string" ? apiOwner : apiOwner(this);
        const apiName = `${owner}.${name}`;
        if (lifetimeOf(this).closed)
          throw prefixApiError(new TargetClosedError(), apiName);
        try {
          return await call.apply(this, args);
        } catch (error) {
          throw isTargetClosedError(error)
            ? prefixApiError(error, apiName)
            : error;
        }
      },
    });
  }
}
