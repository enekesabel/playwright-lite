/**
 * Replacing a function the host document owns is the last resort: it is only
 * done where neither a listener nor a native observer can report what
 * Playwright reports. A page nobody subscribed on replaces nothing.
 */

type HostFunction = (...args: never[]) => unknown;

/** Receives the call the wrapper intercepted, with the original to forward to. */
export type HostCallInterceptor<T extends HostFunction> = (
  original: T,
  thisArg: unknown,
  args: unknown[]
) => unknown;

/**
 * A host function replaced by a callable `Proxy` for as long as at least one
 * subscriber holds it.
 *
 * The proxy traps only `apply`, so `name`, `length` and
 * `Function.prototype.toString` keep answering for the original function, and
 * `this` and the arguments reach it untouched: a call with a receiver the
 * platform object rejects still throws the same `TypeError`.
 */
export class WrappedHostFunction<T extends HostFunction> {
  private subscribers = 0;
  private original: T | undefined;
  private proxy: T | undefined;

  constructor(
    private readonly holder: Record<string, unknown>,
    private readonly name: string,
    private readonly intercept: HostCallInterceptor<T>
  ) {}

  /**
   * Installs the wrapper for the first subscriber. The returned release
   * removes the last subscriber's wrapper, and is idempotent.
   */
  subscribe(): () => void {
    if (this.subscribers++ === 0) this.install();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.subscribers === 0) this.restore();
    };
  }

  private install() {
    const original = this.holder[this.name] as T;
    this.original = original;
    this.proxy = new Proxy(original, {
      apply: (target, thisArg, args) =>
        this.intercept(target as T, thisArg, args),
    });
    this.holder[this.name] = this.proxy;
  }

  private restore() {
    // A wrapper the host installed after ours closes over ours; assigning the
    // original back would strip it. Leave the property alone unless it still
    // holds the proxy this object installed.
    if (this.holder[this.name] === this.proxy)
      this.holder[this.name] = this.original;
    this.proxy = undefined;
    this.original = undefined;
  }
}
