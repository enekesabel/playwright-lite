import { Map, WeakMap } from "virtual:playwright-lite-globals";

/**
 * Replacing a function the host document owns is the last resort: it is only
 * done where neither a listener nor a native observer can report what
 * Playwright reports. A page nobody subscribed on replaces nothing.
 */

type HostFunction = (...args: never[]) => unknown;

/**
 * One instance per window, created by `create` on first use and shared by
 * every later caller for the same window.
 */
export function perWindow<T>(
  create: (browserWindow: Window & typeof globalThis) => T
): (browserWindow: Window & typeof globalThis) => T {
  const instances = new WeakMap<Window, T>();
  return (browserWindow) => {
    let instance = instances.get(browserWindow);
    if (instance === undefined)
      instances.set(browserWindow, (instance = create(browserWindow)));
    return instance;
  };
}

/**
 * A host function to replace: `holder[name]`, and what receives each call.
 * `intercept` gets the original to forward to, and is called directly by the
 * proxy's `apply` trap, so the call chain above it has a fixed depth.
 */
export interface HostMember<T extends HostFunction = HostFunction> {
  readonly holder: Record<string, unknown>;
  readonly name: string;
  intercept(original: T, thisArg: unknown, args: unknown[]): unknown;
}

/**
 * A host function replaced by a callable `Proxy` between `install` and
 * `restore`.
 *
 * The proxy traps only `apply`, so `name`, `length` and
 * `Function.prototype.toString` keep answering for the original function, and
 * `this` and the arguments reach it untouched: a call with a receiver the
 * platform object rejects still throws the same `TypeError`. While nothing
 * is installed, every proxy this object made forwards calls to its original
 * untouched, so a Site's wrapper that closed over one keeps working
 * unobserved.
 */
class WrappedHostFunction {
  private original: HostFunction | undefined;
  private proxy: HostFunction | undefined;

  constructor(private readonly member: HostMember) {}

  install() {
    const { holder, name } = this.member;
    const original = holder[name] as HostFunction;
    const proxy = new Proxy(original, {
      apply: (target, thisArg, args) =>
        this.proxy !== undefined
          ? this.member.intercept(target, thisArg, args)
          : Reflect.apply(target, thisArg, args),
    });
    this.original = original;
    this.proxy = proxy;
    holder[name] = proxy;
  }

  restore() {
    const { holder, name } = this.member;
    // A wrapper the host installed after ours closes over ours; assigning the
    // original back would strip it. Leave the property alone unless it still
    // holds the proxy this object installed.
    if (holder[name] === this.proxy) holder[name] = this.original;
    this.proxy = undefined;
    this.original = undefined;
  }
}

/**
 * Host functions replaced together as one subscription, and the reporters
 * subscribed to them. Every wrapper is installed when the first reporter
 * subscribes and restored when the last one releases.
 *
 * This is the only subscription count: a reporter subscribed n times is
 * reported to once per call, until its n-th release.
 */
export class HostObservation<Report extends (...args: never[]) => void> {
  private readonly wrappers: readonly WrappedHostFunction[];
  private readonly reporters = new Map<Report, number>();

  constructor(
    members: readonly HostMember[],
    private readonly options: {
      /** Runs after the first subscription has installed the wrappers. */
      onFirstSubscribe?: () => void;
      /** Runs after the last release has restored the wrappers. */
      onLastRelease?: () => void;
    } = {}
  ) {
    this.wrappers = members.map((member) => new WrappedHostFunction(member));
  }

  /** Reports to `report` until the returned release is called. The release is idempotent. */
  subscribe(report: Report): () => void {
    const first = this.reporters.size === 0;
    // Registered before installing: assigning a wrapper can run a Site
    // accessor synchronously, which must already see an active subscription
    // and must not start a second installation by subscribing again.
    this.reporters.set(report, (this.reporters.get(report) ?? 0) + 1);
    if (first) {
      for (const wrapper of this.wrappers) wrapper.install();
      this.options.onFirstSubscribe?.();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = this.reporters.get(report)! - 1;
      if (held > 0) {
        this.reporters.set(report, held);
        return;
      }
      this.reporters.delete(report);
      if (this.reporters.size > 0) return;
      for (const wrapper of this.wrappers) wrapper.restore();
      this.options.onLastRelease?.();
    };
  }

  /**
   * Calls every subscribed reporter once, synchronously, over a snapshot
   * taken now. A reporter's throw is not caught: it reaches the caller and
   * skips the reporters after it.
   */
  report(...args: Parameters<Report>): void {
    for (const reporter of [...this.reporters.keys()]) reporter(...args);
  }
}
