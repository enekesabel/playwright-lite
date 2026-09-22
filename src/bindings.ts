/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's binding surface accepts arbitrary values. */
import {
  kBindingsControllerProperty,
  kFunctionBindingPrefix,
} from "virtual:playwright-lite-evaluation";

/** Pinned client/page.ts `exposeBinding`'s first callback argument, minus
 * `context`: this package has no `BrowserContext`. */
export type BindingSource = { page: unknown; frame: unknown };
export type Binding = (source: BindingSource, ...args: any[]) => unknown;

/** The `Page` a binding dispatches through: its `source` and its by-value
 * round trip for that binding's arguments and result. */
export interface BindingOwner {
  readonly source: BindingSource;
  toByValue(value: unknown): unknown;
}

type BindingEntry = { owner: BindingOwner; handler: Binding };

/**
 * Pinned server/page.ts `_pageBindings`: one registry per window, since the
 * pinned UtilityScript bundle calls back into a single `window[name]`.
 */
export class PageBindings {
  private readonly bindings = new Map<string, BindingEntry>();
  private controllerInstalled = false;
  private nextCallbackId = 0;

  constructor(private readonly window: Window & typeof globalThis) {}

  /** Pinned server/page.ts `exposeBinding`'s duplicate-name error. Installs `window[name]`. */
  expose(owner: BindingOwner, name: string, handler: Binding): void {
    if (this.bindings.has(name))
      throw new Error(`Function "${name}" has been already registered`);
    this.install(name, { owner, handler });
    (this.window as unknown as Record<string, unknown>)[name] = (
      ...args: unknown[]
    ) => this.callBinding(name, ...args);
  }

  /**
   * Registers the callback a function nested in an `evaluate(..., {
   * exposeFunctions: true })` argument becomes, under a fresh generated name.
   * Mirrors pinned client/jsHandle.ts `serializeArgumentWithCallbacks` /
   * `page._exposeEvaluateCallback`: the binding ignores `source` (there is no
   * caller frame to report), forwards the call's own arguments, and (pinned
   * `noGlobal: true`) never installs on `window`.
   */
  registerEvaluateCallback(
    owner: BindingOwner,
    fn: (...args: any[]) => unknown
  ): string {
    const name = kFunctionBindingPrefix + this.nextCallbackId++;
    this.install(name, { owner, handler: (_source, ...args) => fn(...args) });
    return name;
  }

  /** Installs the controller the first time anything is registered. */
  private install(name: string, entry: BindingEntry): void {
    if (!this.controllerInstalled) {
      this.controllerInstalled = true;
      // Mirrors pinned server/page.ts PageBinding.createInitScript.
      (this.window as unknown as Record<string, unknown>)[
        kBindingsControllerProperty
      ] = {
        callBinding: (name: string, ...args: unknown[]) =>
          this.callBinding(name, ...args),
      };
    }
    this.bindings.set(name, entry);
  }

  /** Pinned server/page.ts `PageBinding.dispatch`: the result or the thrown
   * error both cross back through the owning page's by-value round trip
   * (`serializeError`/`parseError`'s pinned equivalent). */
  private async callBinding(name: string, ...args: unknown[]): Promise<unknown> {
    const entry = this.bindings.get(name);
    if (!entry) throw new Error(`Function "${name}" is not exposed`);
    const { owner, handler } = entry;
    try {
      const result = await handler(
        owner.source,
        ...args.map((arg) => owner.toByValue(arg))
      );
      return owner.toByValue(result);
    } catch (error) {
      throw owner.toByValue(error);
    }
  }
}

const controllers = new WeakMap<Window, PageBindings>();

/** The one binding registry of a window, created for its first subscriber. */
export function bindingsFor(
  browserWindow: Window & typeof globalThis
): PageBindings {
  let controller = controllers.get(browserWindow);
  if (!controller)
    controllers.set(browserWindow, (controller = new PageBindings(browserWindow)));
  return controller;
}
