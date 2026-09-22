/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's binding surface accepts arbitrary values. */

/**
 * Pinned isomorphic/utilityScriptSerializers.ts constants
 * (26a9e470a7b3c7822084b09fb7f13902c5f37b51). The bundled pinned UtilityScript
 * this package compiles from `packages/injected/src/utilityScript.ts` reads
 * `globalThis[kBindingsControllerProperty]` itself when its
 * `parseEvaluationResultValue` reconstructs an argument carrying a `{ fn }`
 * marker into a callable function, and re-emits `{ fn: name }` for any
 * function whose `name` starts with `kFunctionBindingPrefix`
 * (`serializeAsCallArgument`). Both strings must match the bundle exactly.
 */
const BINDINGS_CONTROLLER_PROPERTY = "__playwright__binding__controller__";
const FUNCTION_BINDING_PREFIX = "__pw_fn_";

/** Pinned client/page.ts `exposeBinding`'s first callback argument, minus
 * `context`: this package has no `BrowserContext`. */
export type BindingSource = { page: unknown; frame: unknown };
export type Binding = (source: BindingSource, ...args: any[]) => unknown;

/**
 * The `window[name]` bindings installed by `exposeFunction`/`exposeBinding`,
 * and the anonymous callback bindings `evaluate(..., { exposeFunctions: true
 * })` registers for the functions nested in its argument. Shared by every
 * `Page` created for the same window, the way `NetworkObservation` is: a
 * second controller would not see the first one's bindings, and the pinned
 * UtilityScript bundle can call back into only one `window[name]`.
 *
 * Args and results cross through `toByValue`, the owning `Page`'s existing
 * by-value round trip (`Evaluation.bindingValue`): this package has no
 * Node/browser split to serialize a call across, so a binding call is one
 * round trip, not the two hops the pinned client and server each take.
 */
export class PageBindings {
  private readonly bindings = new Map<string, Binding>();
  private readonly source: BindingSource;

  constructor(
    private readonly window: Window & typeof globalThis,
    page: unknown,
    private readonly toByValue: (value: unknown) => unknown
  ) {
    this.source = { page, frame: page };
    const holder = window as unknown as Record<string, unknown>;
    // Mirrors pinned server/page.ts PageBinding.createInitScript: install the
    // controller once per window, the first time something needs it.
    holder[BINDINGS_CONTROLLER_PROPERTY] ??= {
      callBinding: (name: string, ...args: unknown[]) =>
        this.callBinding(name, ...args),
    };
  }

  /** Pinned server/page.ts `exposeBinding`'s duplicate-name error. `global`
   * installs `window[name]`; a callback registered for `evaluate`'s
   * `exposeFunctions` option does not (pinned `noGlobal: true`). */
  expose(name: string, handler: Binding, global: boolean): void {
    if (this.bindings.has(name))
      throw new Error(`Function "${name}" has been already registered`);
    this.bindings.set(name, handler);
    if (global)
      (this.window as unknown as Record<string, unknown>)[name] = (
        ...args: unknown[]
      ) => this.callBinding(name, ...args);
  }

  /**
   * Registers the callback a function nested in an `evaluate(..., {
   * exposeFunctions: true })` argument becomes, under a fresh generated name.
   * Mirrors pinned client/jsHandle.ts `serializeArgumentWithCallbacks` /
   * `page._exposeEvaluateCallback`: the binding ignores `source` (there is no
   * caller frame to report) and forwards the call's own arguments.
   */
  registerEvaluateCallback(fn: (...args: any[]) => unknown): string {
    const name =
      FUNCTION_BINDING_PREFIX +
      (this.window.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
    this.expose(name, (_source, ...args) => fn(...args), false);
    return name;
  }

  private async callBinding(
    name: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const binding = this.bindings.get(name);
    if (!binding) throw new Error(`Function "${name}" is not exposed`);
    const result = await binding(
      this.source,
      ...args.map((arg) => this.toByValue(arg))
    );
    return this.toByValue(result);
  }
}

const controllers = new WeakMap<Window, PageBindings>();

/** The one binding registry of a window, created for its first subscriber. */
export function bindingsFor(
  browserWindow: Window & typeof globalThis,
  page: unknown,
  toByValue: (value: unknown) => unknown
): PageBindings {
  let controller = controllers.get(browserWindow);
  if (!controller)
    controllers.set(
      browserWindow,
      (controller = new PageBindings(browserWindow, page, toByValue))
    );
  return controller;
}
