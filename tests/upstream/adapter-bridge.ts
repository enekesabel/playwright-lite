/**
 * Bridges the @enekesabel/playwright-lite in-browser adapter with
 * Playwright Test's Node.js fixture. Loads the compiled dist bundle
 * (which includes the real pinned InjectedScript), injects it into
 * the browser page, and creates proxy Page/Locator objects that route
 * all compatibility calls through the adapter.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  errors as playwrightErrors,
  type Locator,
  type Page,
  type Playwright,
} from "@playwright/test";
import {
  formatLocatorChainDescription,
  locatorDescription,
} from "../../src/locatorFormatting";
import { statusFor } from "../../compatibility/api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIST_PATH = resolve(__dirname, "../../dist/index.mjs");
const LOCATOR_CHAIN_PAYLOAD = "__pwLiteLocatorChain";
const ELEMENT_HANDLE_REF_PAYLOAD = "__pwLiteElementHandleRef";
const ABORT_SIGNAL_PAYLOAD = "__pwLiteAbortSignal";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";
let nextAbortSignalId = 0;
type ChainStep = [string, unknown[]];
type AdapterPageState = {
  url: string;
  nativeNavigationForSetup?: boolean;
};
type AdapterTimeoutDefaults = {
  actionTimeout?: number;
  navigationTimeout?: number;
  // Fixture-only settings. None is a production createPage option.
  nativeNavigationForSetup?: boolean;
  underTest?: boolean;
  // Recorded adapter method name (`Page.fill`, `Locator._expect`, …) whose
  // in-browser dispatch throws instead of executing, so a promotion rerun can
  // show that the test actually depends on it.
  sabotagedMethod?: string;
};

const nativeLocatorReferences = new WeakMap<Page, Map<string, Locator>>();

function isOutOfScope(owner: "Page" | "Locator", member: string) {
  return statusFor(owner, member) === "out-of-scope";
}

function nativeOperationLog(realPage: Page) {
  return (realPage as any).__pwLiteNativeOperations as string[];
}

function nativeKind(value: object): string {
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name && name !== "Object" ? name.replace(/^_/, "") : "Native";
}

function wrapNativeResult(value: unknown, realPage: Page): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return value;
  if (typeof (value as Promise<unknown>).then === "function")
    return (value as Promise<unknown>).then((resolved) =>
      wrapNativeResult(resolved, realPage)
    );

  return new Proxy(value as object, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined;
      const member = Reflect.get(target, prop, receiver);
      if (typeof prop === "symbol" || typeof member !== "function")
        return wrapNativeResult(member, realPage);
      return (...args: unknown[]) => {
        nativeOperationLog(realPage).push(`${nativeKind(target)}.${prop}`);
        return wrapNativeResult(member.apply(target, args), realPage);
      };
    },
  });
}

function nativeLocatorArgument(value: unknown, realPage: Page): unknown {
  const chain =
    value && typeof value === "object"
      ? locatorProxyChains.get(value)
      : undefined;
  if (chain) return nativeLocatorForChain(realPage, chain);
  if (!value || typeof value !== "object") return value;
  if (value instanceof RegExp) return value;
  if (Array.isArray(value))
    return value.map((item) => nativeLocatorArgument(item, realPage));
  if (!isPlainObject(value))
    throw new TypeError(
      "Cannot reconstruct a native locator from a non-plain bridge argument."
    );
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      nativeLocatorArgument(item, realPage),
    ])
  );
}

function nativeLocatorForChain(realPage: Page, chain: ChainStep[]): Locator {
  let current: any = realPage;
  for (const [method, rawArgs] of chain) {
    if (method === "__pwLiteLocatorRef") {
      current = nativeLocatorReferences
        .get(realPage)
        ?.get(rawArgs[0] as string);
      if (!current)
        throw new Error(
          "Unknown native counterpart for browser locator reference."
        );
      continue;
    }
    const member = current[method];
    if (typeof member !== "function")
      throw new Error(
        `Cannot reconstruct native locator chain step: ${method}`
      );
    current = member.apply(
      current,
      rawArgs.map((arg) => nativeLocatorArgument(arg, realPage))
    );
  }
  return current as Locator;
}

// Kept exclusively in the Node fixture. Browser Locator objects never need a
// serialization format in production; this only gets proxy chains across the
// fixture's realPage.evaluate boundary.
const locatorProxyChains = new WeakMap<object, ChainStep[]>();
type ElementHandleProxyReference = { realPage: Page; id: string };
const elementHandleProxyReferences = new WeakMap<
  object,
  ElementHandleProxyReference
>();

// Locator-creating page methods: return a proxy locator chain.
const LOCATOR_CREATING_METHODS = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByTestId",
  "getByTitle",
  "getByAltText",
]);

// Locator chain methods: extend the chain, return a new proxy locator.
const LOCATOR_CHAIN_METHODS = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByTestId",
  "getByTitle",
  "getByAltText",
  "filter",
  "nth",
  "first",
  "last",
  "and",
  "or",
]);

function encodeBridgeValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
  ownerPage?: Page
): unknown {
  if (typeof value === "function")
    throw new TypeError(
      "The upstream adapter bridge does not support nested function arguments or event callbacks."
    );
  if (!value || typeof value !== "object") return value;

  const locatorChain = locatorProxyChains.get(value);
  if (locatorChain)
    return {
      [LOCATOR_CHAIN_PAYLOAD]: encodeBridgeValue(locatorChain, seen, ownerPage),
    };

  const elementHandle = elementHandleProxyReferences.get(value);
  if (elementHandle) {
    if (ownerPage && elementHandle.realPage !== ownerPage)
      throw new TypeError(
        "The upstream adapter bridge cannot use an ElementHandle from another adapter context."
      );
    return { [ELEMENT_HANDLE_REF_PAYLOAD]: elementHandle.id };
  }

  const previous = seen.get(value);
  if (previous !== undefined) return previous;

  // Transport only. The runtime receives bytes and owns file assignment.
  // Buffer extends Uint8Array; preserve subarray offsets by copying its view.
  if (value instanceof Uint8Array) return { __pwLiteBytes: Array.from(value) };

  if (Array.isArray(value)) {
    const encoded: unknown[] = [];
    seen.set(value, encoded);
    for (const item of value)
      encoded.push(encodeBridgeValue(item, seen, ownerPage));
    return encoded;
  }

  // Playwright transports regular expressions in locator options. Browser
  // handles, frames, and other live driver objects are deliberately excluded:
  // this single-document adapter cannot make their identity meaningful.
  if (value instanceof RegExp) return value;
  if (!isPlainObject(value))
    throw new TypeError(
      "The upstream adapter bridge does not support handles, frames, or non-plain object arguments."
    );
  const encoded: Record<string, unknown> = {};
  seen.set(value, encoded);
  for (const [key, item] of Object.entries(value))
    encoded[key] = encodeBridgeValue(item, seen, ownerPage);
  return encoded;
}

function encodeBridgeValueForPage(value: unknown, realPage: Page): unknown {
  return encodeBridgeValue(value, new WeakMap<object, unknown>(), realPage);
}

function serializableAbortReason(reason: unknown): unknown {
  if (reason instanceof Error)
    return {
      __pwLiteAbortError: true,
      name: reason.name,
      message: reason.message,
    };
  if (
    reason === undefined ||
    reason === null ||
    typeof reason === "string" ||
    typeof reason === "number" ||
    typeof reason === "boolean"
  )
    return reason;
  return String(reason);
}

async function withAbortSignalBridge<Result>(
  realPage: Page,
  args: unknown[],
  invoke: (encodedArgs: unknown[]) => Promise<Result>
): Promise<Result> {
  const options = args.at(-1);
  const signal =
    options && isPlainObject(options) && options.signal instanceof AbortSignal
      ? options.signal
      : undefined;
  if (!signal)
    return invoke(encodeBridgeValueForPage(args, realPage) as unknown[]);

  const id = `signal-${++nextAbortSignalId}`;
  const encodedArgs = args.slice();
  encodedArgs[encodedArgs.length - 1] = {
    ...options,
    signal: {
      [ABORT_SIGNAL_PAYLOAD]: id,
      aborted: signal.aborted,
      reason: serializableAbortReason(signal.reason),
    },
  };

  let forwarding: Promise<unknown> | undefined;
  const forwardAbort = () => {
    forwarding = realPage
      .evaluate(
        ({ signalId, reason }) =>
          (window as any).__pwLiteAbortSignal(signalId, reason),
        { signalId: id, reason: serializableAbortReason(signal.reason) }
      )
      .catch(() => undefined);
  };
  signal.addEventListener("abort", forwardAbort, { once: true });
  try {
    return await invoke(
      encodeBridgeValueForPage(encodedArgs, realPage) as unknown[]
    );
  } catch (error) {
    // Restore identity only for an adapter AbortError that already carried
    // this reason in the browser; never fabricate a cause for other failures.
    if (error instanceof Error && abortErrorsCarryingTheirReason.has(error))
      Object.defineProperty(error, "cause", {
        configurable: true,
        value: signal.reason,
      });
    throw error;
  } finally {
    signal.removeEventListener("abort", forwardAbort);
    await forwarding;
    void realPage
      .evaluate((signalId) => {
        const host = window as any;
        host.__pwLiteAbortSignals?.delete(signalId);
        host.__pwLitePendingAborts?.delete(signalId);
      }, id)
      .catch(() => undefined);
  }
}

function callbackSource(callback: unknown, operation: string): string {
  if (typeof callback !== "function")
    throw new TypeError(
      `${operation} requires a function callback in the upstream adapter bridge.`
    );
  return String(callback);
}

type BridgeEnvelope<Result> =
  | { kind: "value"; value: Result }
  | { kind: "adapter-timeout"; message: string }
  | {
      kind: "adapter-error";
      name: string;
      message: string;
      causeMatchedAbortReason?: boolean;
    };

/**
 * Adapter errors whose browser-side `cause` was the abort reason the adapter
 * was given. Only those may have the reason's object identity restored on the
 * Node side, because identity cannot survive the evaluation boundary.
 */
const abortErrorsCarryingTheirReason = new WeakSet<Error>();

const testIdAttributeSynchronizers = new WeakMap<Page, () => Promise<void>>();

type SelectorsWithWritableTestIdAttribute = Playwright["selectors"] & {
  setTestIdAttribute: (attributeName: string) => void;
};

/**
 * Mirrors Playwright's selectors.setTestIdAttribute propagation in the
 * fixture only. The fixture passes its initial value to createPage and updates
 * the same adapter instance when upstream tests change the selector setting.
 */
export async function installTestIdAttributeSynchronization(
  realPage: Page,
  playwright: Playwright,
  initialAttributeName = DEFAULT_TEST_ID_ATTRIBUTE
): Promise<() => Promise<void>> {
  const selectors =
    playwright.selectors as SelectorsWithWritableTestIdAttribute;
  const originalSetTestIdAttribute = selectors.setTestIdAttribute;
  let synchronization = Promise.resolve();

  const synchronizeBrowser = (attributeName: string) =>
    realPage.evaluate((testIdAttributeName) => {
      (
        window as Window & { __pwLiteTestIdAttributeName?: string }
      ).__pwLiteTestIdAttributeName = testIdAttributeName;
      const adapter = (
        window as Window & { __pwLiteAdapterPage?: { testIdAttribute: string } }
      ).__pwLiteAdapterPage;
      if (adapter) adapter.testIdAttribute = testIdAttributeName;
    }, attributeName);

  const queueSynchronization = (attributeName: string) => {
    synchronization = synchronization.then(
      () => synchronizeBrowser(attributeName),
      () => synchronizeBrowser(attributeName)
    );
  };

  const synchronize = (attributeName: string) => {
    originalSetTestIdAttribute.call(selectors, attributeName);
    queueSynchronization(attributeName);
  };

  selectors.setTestIdAttribute = synchronize;
  try {
    synchronize(initialAttributeName);
    await synchronization;
  } catch (error) {
    selectors.setTestIdAttribute = originalSetTestIdAttribute;
    originalSetTestIdAttribute.call(selectors, DEFAULT_TEST_ID_ATTRIBUTE);
    testIdAttributeSynchronizers.delete(realPage);
    throw error;
  }
  testIdAttributeSynchronizers.set(realPage, () => synchronization);

  return async () => {
    selectors.setTestIdAttribute = originalSetTestIdAttribute;
    originalSetTestIdAttribute.call(selectors, DEFAULT_TEST_ID_ATTRIBUTE);
    // The fixture discards this page. Reset only shared worker state; the
    // document may already be gone after a native navigation.
    testIdAttributeSynchronizers.delete(realPage);
  };
}

function unwrapBridgeEnvelope<Result>(
  envelope: BridgeEnvelope<Result>
): Result {
  if (
    envelope.kind === "adapter-timeout" &&
    typeof envelope.message === "string"
  )
    throw new playwrightErrors.TimeoutError(envelope.message);
  if (envelope.kind === "adapter-error") {
    const error = new Error(envelope.message);
    error.name = envelope.name;
    if (envelope.causeMatchedAbortReason)
      abortErrorsCarryingTheirReason.add(error);
    throw error;
  }
  return envelope.value;
}

async function evaluateAdapter<Result>(
  realPage: Page,
  pageFunction: unknown,
  arg: unknown
): Promise<Result> {
  await testIdAttributeSynchronizers.get(realPage)?.();
  return unwrapBridgeEnvelope(
    await (
      realPage.evaluate as (
        callback: unknown,
        argument: unknown
      ) => Promise<BridgeEnvelope<Result>>
    )(pageFunction, arg)
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ── Adapter bundle ──────────────────────────────────────────────────

let cachedBundle: string | undefined;

function buildAdapterBundle(): string {
  if (cachedBundle) return cachedBundle;

  const dist = readFileSync(ADAPTER_DIST_PATH, "utf8");

  // Strip ES module export declaration so the code runs as a script.
  const js = dist.replace(/^export\s+\{[^}]*\}.*$/gm, "");

  cachedBundle = [
    "window.__pwLiteAdapter = (function() {",
    js,
    "return { createPage: createPage };",
    "})();",
  ].join("\n");

  return cachedBundle;
}

// ── Page proxy ──────────────────────────────────────────────────────

export async function createAdapterPage(
  realPage: Page,
  timeoutDefaults: AdapterTimeoutDefaults = {}
): Promise<Page> {
  const bundle = buildAdapterBundle();
  const configuredTimeouts = [
    typeof timeoutDefaults.actionTimeout === "number"
      ? `window.__pwLiteAdapterPage.setDefaultTimeout(${JSON.stringify(timeoutDefaults.actionTimeout)});`
      : "",
    typeof timeoutDefaults.navigationTimeout === "number"
      ? `window.__pwLiteAdapterPage.setDefaultNavigationTimeout(${JSON.stringify(timeoutDefaults.navigationTimeout)});`
      : "",
  ].join("\n");
  const adapterPageSetup =
    "\nwindow.builtins ??= {}; window.builtins.Date ??= window.Date;" +
    "\nwindow.__pwLiteAdapterPage = window.__pwLiteAdapter.createPage({ testIdAttribute: window.__pwLiteTestIdAttributeName });" +
    `\n${configuredTimeouts}` +
    // Pinned upstream tests expose the highlight shadow root in test mode.
    // Keep production closed-root behavior unchanged and separately tested.
    (timeoutDefaults.underTest
      ? `
        {
          // Init scripts run before documentElement exists. Preserve the lazy
          // production getter; only expose overlays when it is actually used.
          const page = window.__pwLiteAdapterPage;
          const getInjected = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(page), "injected"
          ).get;
          Object.defineProperty(page, "injected", {
            get() {
              const injected = getInjected.call(this);
              injected.isUnderTest = true;
              return injected;
            },
          });
        }`
      : "") +
    `\n(${initializeAdapterBridge.toString()})(${JSON.stringify(
      timeoutDefaults.sabotagedMethod ?? null
    )});`;

  // Single init script: on every navigation, inject the adapter bundle
  // and create the adapter page from the current window.
  await realPage.addInitScript(bundle + adapterPageSetup);

  // Init scripts apply to future navigations. Execute the same bundle in the
  // page Playwright Test already created so its initial about:blank document
  // remains intact.
  await realPage.evaluate(
    (source) => (0, eval)(source),
    bundle + adapterPageSetup
  );

  const evaluate = realPage.evaluate.bind(realPage);
  const failures: string[] = [];
  (realPage as any).__pwLiteTransportFailures = failures;
  (realPage as any).__pwLiteNativeOperations = [] as string[];
  realPage.evaluate = (async (...args: any[]) => {
    try {
      return await (evaluate as any)(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /is not a function|serializ|execution context|target.*closed/i.test(
          message
        )
      )
        failures.push(message.split("\n")[0]);
      throw error;
    }
  }) as Page["evaluate"];
  const state: AdapterPageState = {
    nativeNavigationForSetup: timeoutDefaults.nativeNavigationForSetup,
    url: await evaluateAdapter(
      realPage,
      () => {
        const host = window as any;
        return host.__pwLiteInvokeAdapter(() => host.__pwLiteAdapterPage.url());
      },
      undefined
    ),
  };
  return createPageProxy(realPage, state);
}

function createPageProxy(realPage: Page, state: AdapterPageState): Page {
  const storage = {
    localStorage: createWebStorageProxy(realPage, "localStorage"),
    sessionStorage: createWebStorageProxy(realPage, "sessionStorage"),
  };
  return new Proxy(realPage, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (prop === "__pwLiteAdapter") return true;
      if (prop === "then") return undefined;

      // The production single-document adapter defines mainFrame() as the
      // current Page facade. Preserve that synchronous identity without
      // exposing Playwright's real Frame object through the fixture.
      if (prop === "mainFrame") return () => createPageProxy(realPage, state);

      // Page.url() is synchronous in Playwright's public API. Keep the
      // adapter-observed value locally after asynchronous bridge operations.
      if (prop === "url") return () => state.url;

      // Keyboard is a synchronous Page property whose methods must execute in
      // the browser adapter. Do not leak the native Playwright keyboard.
      if (prop === "keyboard") return createKeyboardProxy(realPage);
      if (prop === "localStorage" || prop === "sessionStorage")
        return storage[prop];

      // Explicit fixture setup, never fallback after an adapter failure.
      // Only specs whose subject is storage/highlighting opt in. Every such
      // navigation is recorded and cannot certify Page.goto compatibility.
      if (prop === "goto" && state.nativeNavigationForSetup) {
        return async (...args: Parameters<Page["goto"]>) => {
          const previous = await realPage.evaluate(
            () => (window as any).__pwLiteEvidence
          );
          nativeOperationLog(realPage).push("Page.goto");
          const response = await realPage.goto(...args);
          await realPage.evaluate((prior) => {
            const current = (window as any).__pwLiteEvidence;
            current.entered.unshift(...prior.entered);
            current.failures.unshift(...prior.failures);
          }, previous);
          state.url = await evaluateAdapter<string>(
            realPage,
            () => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() =>
                host.__pwLiteAdapterPage.url()
              );
            },
            undefined
          );
          return wrapNativeResult(response, realPage);
        };
      }

      // Only ledger-declared out-of-scope Page members may use the native
      // driver. Record them, and wrap any object they return so downstream
      // native operations cannot be mistaken for browser adapter evidence.
      if (isOutOfScope("Page", prop)) {
        return (...args: unknown[]) => {
          nativeOperationLog(realPage).push(`Page.${prop}`);
          const nativeMember = Reflect.get(target, prop, receiver);
          if (typeof nativeMember !== "function")
            throw new TypeError(`Native Page.${prop} is not a function`);
          return wrapNativeResult(nativeMember.apply(target, args), realPage);
        };
      }

      // Locator-creating: return proxy locator.
      if (LOCATOR_CREATING_METHODS.has(prop)) {
        return (...args: unknown[]) =>
          createLocatorProxy(realPage, state, [[prop, args]]);
      }

      if (prop === "$" || prop === "waitForSelector") {
        return async (selector: string, options?: unknown) =>
          withAbortSignalBridge(
            realPage,
            [selector, options],
            async ([s, o]) => {
              const id = await evaluateAdapter<string | null>(
                realPage,
                ({ method, selector: encodedSelector, options: encoded }) => {
                  const host = window as any;
                  return host.__pwLiteInvokeAdapter(
                    async () =>
                      host.__pwLiteStoreElementHandle(
                        await host.__pwLiteAdapterPage[method](
                          encodedSelector,
                          host.__pwLiteDecodeBridgeValue(encoded)
                        )
                      ),
                    encoded
                  );
                },
                { method: prop, selector: s, options: o }
              );
              return id ? createElementHandleProxy(realPage, state, id) : null;
            }
          );
      }

      if (prop === "$$") {
        return async (selector: string) => {
          const ids = await evaluateAdapter<string[]>(
            realPage,
            ({ selector: s }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                (await host.__pwLiteAdapterPage.$$(s)).map((handle: any) =>
                  host.__pwLiteStoreElementHandle(handle)
                )
              );
            },
            { selector }
          );
          return Promise.all(
            ids.map((id) => createElementHandleProxy(realPage, state, id))
          );
        };
      }

      // ── Callback transport ─────────────────────────────────────────
      // Functions cannot cross realPage.evaluate. Reconstruct the selected
      // upstream callback shape in the browser, then invoke PageImpl's public
      // API. Production PageImpl receives the callback directly.

      if (prop === "evaluate") {
        return async (pageFunction: unknown, arg?: unknown) => {
          const result = await evaluateAdapter<{ value: unknown; url: string }>(
            realPage,
            ({ expression, isFunction, arg: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const callback = isFunction
                  ? (0, eval)(`(${expression})`)
                  : expression;
                return {
                  value: await host.__pwLiteAdapterPage.evaluate(
                    callback,
                    host.__pwLiteDecodeBridgeValue(a)
                  ),
                  url: host.__pwLiteAdapterPage.url(),
                };
              });
            },
            {
              expression: String(pageFunction),
              isFunction: typeof pageFunction === "function",
              arg: encodeBridgeValueForPage(arg, realPage),
            }
          );
          state.url = result.url;
          return result.value;
        };
      }

      if (prop === "waitForFunction") {
        return async (
          pageFunction: unknown,
          arg?: unknown,
          options?: unknown
        ) => {
          const id = await evaluateAdapter<string>(
            realPage,
            ({ expression, isFunction, arg: a, options: opts }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const handle = await host.__pwLiteAdapterPage.waitForFunction(
                  isFunction ? (0, eval)(`(${expression})`) : expression,
                  host.__pwLiteDecodeBridgeValue(a),
                  host.__pwLiteDecodeBridgeValue(opts)
                );
                return host.__pwLiteStoreElementHandle(handle, "JSHandle");
              });
            },
            {
              expression: String(pageFunction),
              isFunction: typeof pageFunction === "function",
              arg: encodeBridgeValueForPage(arg, realPage),
              options: encodeBridgeValueForPage(options, realPage) as Record<
                string,
                unknown
              >,
            }
          );
          return createElementHandleProxy(realPage, state, id);
        };
      }

      // Page.$eval/$$eval callbacks are reconstructed only at this fixture
      // boundary, then passed to the adapter's public browser-native methods.
      if (prop === "$eval" || prop === "$$eval") {
        return async (selector: string, pageFunction: unknown, arg?: unknown) =>
          evaluateAdapter(
            realPage,
            ({ method, selector: s, expression, arg: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() =>
                host.__pwLiteAdapterPage[method](
                  s,
                  (0, eval)(`(${expression})`),
                  host.__pwLiteDecodeBridgeValue(a)
                )
              );
            },
            {
              method: prop,
              selector,
              expression: callbackSource(pageFunction, `Page.${prop}`),
              arg: encodeBridgeValueForPage(arg, realPage),
            }
          );
      }

      // Everything else: route through the adapter page in the browser.
      // Both method calls and property accesses go through the adapter
      // so that unsupported members (keyboard, mouse, touchscreen, etc.)
      // are never leaked from the real Playwright driver.
      return async (...args: unknown[]) =>
        withAbortSignalBridge(realPage, args, async (encodedArgs) => {
          const result = await evaluateAdapter<{ value: unknown; url: string }>(
            realPage,
            ({ member, args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const p = host.__pwLiteAdapterPage;
                const v = p[member];
                const args = host.__pwLiteDecodeBridgeValue(a);
                let value: unknown;
                if (typeof v === "function") value = await v.call(p, ...args);
                else if (a.length === 0 && v !== undefined) value = v;
                else
                  throw new TypeError(
                    `__pwLiteAdapterPage.${member} is not a function`
                  );
                return { value, url: p.url() };
              }, a);
            },
            { member: prop, args: encodedArgs as any[] }
          );
          state.url = result.url;
          return result.value;
        });
    },
  }) as Page;
}

function createWebStorageProxy(
  realPage: Page,
  kind: "localStorage" | "sessionStorage"
): Page["localStorage"] {
  const call = <T>(method: string, args: unknown[]) =>
    evaluateAdapter<T>(
      realPage,
      ({ kind: storageKind, method: member, args: rawArgs }) => {
        const host = window as any;
        return host.__pwLiteInvokeAdapter(() =>
          host.__pwLiteAdapterPage[storageKind][member](
            ...host.__pwLiteDecodeBridgeValue(rawArgs)
          )
        );
      },
      { kind, method, args: encodeBridgeValueForPage(args, realPage) }
    );
  return {
    items: () => call<{ name: string; value: string }[]>("items", []),
    getItem: (name) => call<string | null>("getItem", [name]),
    setItem: (name, value) => call<void>("setItem", [name, value]),
    removeItem: (name) => call<void>("removeItem", [name]),
    clear: () => call<void>("clear", []),
  };
}

function createKeyboardProxy(realPage: Page) {
  const call = async (method: string, args: unknown[]) => {
    if (statusFor("Keyboard", method) !== "implemented")
      throw new TypeError(
        `Keyboard.${method} is not implemented by the adapter`
      );
    return await evaluateAdapter<void>(
      realPage,
      ({ method: member, args: rawArgs }) => {
        const host = window as any;
        return host.__pwLiteInvokeAdapter(() =>
          host.__pwLiteAdapterPage.keyboard[member](
            ...host.__pwLiteDecodeBridgeValue(rawArgs)
          )
        );
      },
      { method, args: encodeBridgeValueForPage(args, realPage) as unknown[] }
    );
  };
  return {
    down: (key: string) => call("down", [key]),
    up: (key: string) => call("up", [key]),
    insertText: (text: string) => call("insertText", [text]),
    type: (text: string, options?: unknown) => call("type", [text, options]),
    press: (key: string, options?: unknown) => call("press", [key, options]),
  };
}

// ── ElementHandle proxy ─────────────────────────────────────────────

async function createElementHandleProxy(
  realPage: Page,
  state: AdapterPageState,
  id: string
): Promise<object> {
  // Like Page.url(), this synchronous API needs a browser-observed snapshot.
  // Read the actual identity result before publishing the proxy; do not assume
  // every stored JSHandle is an ElementHandle or manufacture a passing result.
  const asElement = await evaluateAdapter<"self" | "null" | "unsupported">(
    realPage,
    (handleId) => {
      const host = window as any;
      return host.__pwLiteInvokeAdapter(() => {
        const handle = host.__pwLiteElementHandleForId(handleId);
        if (typeof handle.asElement !== "function") return "unsupported";
        const element = handle.asElement();
        if (element === handle) return "self";
        if (element === null) return "null";
        throw new TypeError(
          "Cannot serialize a non-identity ElementHandle.asElement result."
        );
      });
    },
    id
  );
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "__pwLiteAdapter") return true;
      if (prop === "then") return undefined;
      if (prop === "asElement" && asElement !== "unsupported")
        return () => (asElement === "self" ? proxy : null);

      if (prop === "dispose") {
        return async () =>
          evaluateAdapter(
            realPage,
            (handleId) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() =>
                host.__pwLiteDisposeElementHandle(handleId)
              );
            },
            id
          );
      }

      if (prop === "$" || prop === "waitForSelector") {
        return async (selector: string, options?: unknown) => {
          const childId = await evaluateAdapter<string | null>(
            realPage,
            ({ handleId, method, selector: s, options: o }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                host.__pwLiteStoreElementHandle(
                  await host
                    .__pwLiteElementHandleForId(handleId)
                    [method](s, host.__pwLiteDecodeBridgeValue(o))
                )
              );
            },
            {
              handleId: id,
              method: prop,
              selector,
              options: encodeBridgeValueForPage(options, realPage),
            }
          );
          return childId
            ? createElementHandleProxy(realPage, state, childId)
            : null;
        };
      }

      if (prop === "$$") {
        return async (selector: string) => {
          const ids = await evaluateAdapter<string[]>(
            realPage,
            ({ handleId, selector: s }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                (await host.__pwLiteElementHandleForId(handleId).$$(s)).map(
                  (handle: any) => host.__pwLiteStoreElementHandle(handle)
                )
              );
            },
            { handleId: id, selector }
          );
          return Promise.all(
            ids.map((childId) =>
              createElementHandleProxy(realPage, state, childId)
            )
          );
        };
      }

      if (prop === "$eval" || prop === "$$eval") {
        return async (selector: string, pageFunction: unknown, arg?: unknown) =>
          evaluateAdapter(
            realPage,
            ({ handleId, method, selector: s, expression, arg: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() =>
                host
                  .__pwLiteElementHandleForId(handleId)
                  [method](
                    s,
                    (0, eval)(`(${expression})`),
                    host.__pwLiteDecodeBridgeValue(a)
                  )
              );
            },
            {
              handleId: id,
              method: prop,
              selector,
              expression: callbackSource(pageFunction, `ElementHandle.${prop}`),
              arg: encodeBridgeValueForPage(arg, realPage),
            }
          );
      }

      if (prop === "evaluate") {
        return async (pageFunction: unknown, arg?: unknown) =>
          evaluateAdapter(
            realPage,
            ({ handleId, method, expression, arg: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() =>
                host
                  .__pwLiteElementHandleForId(handleId)
                  [method](
                    (0, eval)(`(${expression})`),
                    host.__pwLiteDecodeBridgeValue(a)
                  )
              );
            },
            {
              handleId: id,
              method: prop,
              expression: callbackSource(pageFunction, `ElementHandle.${prop}`),
              arg: encodeBridgeValueForPage(arg, realPage),
            }
          );
      }

      return async (...args: unknown[]) =>
        evaluateAdapter(
          realPage,
          ({ handleId, method, args: a }) => {
            const host = window as any;
            return host.__pwLiteInvokeAdapter(() =>
              host
                .__pwLiteElementHandleForId(handleId)
                [method](...host.__pwLiteDecodeBridgeValue(a))
            );
          },
          {
            handleId: id,
            method: prop,
            args: encodeBridgeValueForPage(args, realPage) as any[],
          }
        );
    },
  };
  const proxy = new Proxy({}, handler);
  elementHandleProxyReferences.set(proxy, { realPage, id });
  return proxy;
}

function createHighlightDisposableProxy(
  realPage: Page,
  id: string
): Awaited<ReturnType<Locator["highlight"]>> {
  // Retain the returned object for this fixture's document lifetime. Both
  // disposal paths execute on it, including repeated calls and exceptions.
  const invoke = (asyncDispose: boolean) =>
    evaluateAdapter<void>(
      realPage,
      ({ handleId, useSymbol }) => {
        const host = window as any;
        return host.__pwLiteInvokeAdapter(() => {
          const disposable = host.__pwLiteElementHandleForId(handleId);
          return useSymbol
            ? disposable[Symbol.asyncDispose]()
            : disposable.dispose();
        });
      },
      { handleId: id, useSymbol: asyncDispose }
    );
  return {
    dispose: () => invoke(false),
    [Symbol.asyncDispose]: () => invoke(true),
  };
}

// ── Locator proxy ───────────────────────────────────────────────────

function createLocatorProxy(
  realPage: Page,
  state: AdapterPageState,
  chain: ChainStep[],
  description?: string
): Locator {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "__pwLiteAdapter") return true;
      if (prop === "_apiName") return "Locator";
      if (prop === "then") return undefined;

      if (prop === "description") return () => locatorDescription(description);
      if (prop === "toString")
        return () => formatLocatorChainDescription(chain, description);

      if (prop === "describe") {
        return (nextDescription: string) =>
          createLocatorProxy(
            realPage,
            state,
            [...chain, ["describe", [nextDescription]]],
            nextDescription
          );
      }

      // Chain methods (including first/last): extend the chain and let
      // the actual adapter determine support/behavior.
      if (LOCATOR_CHAIN_METHODS.has(prop as string)) {
        return (...args: unknown[]) =>
          createLocatorProxy(realPage, state, [
            ...chain,
            [prop as string, args],
          ]);
      }

      // Preserve the actual browser-returned locators, not a reconstruction
      // from the array length. Subsequent calls execute on those objects.
      if (prop === "all") {
        return async () => {
          const references: { id: string; selector: string }[] =
            await evaluateAdapter(
              realPage,
              async ({ chain: c }) => {
                const host = window as any;
                return host.__pwLiteInvokeAdapter(async () => {
                  const current: any = host.__pwLiteReplayAdapterChain(c);
                  return (await current.all()).map((locator: any) =>
                    host.__pwLiteStoreLocator(locator)
                  );
                });
              },
              { chain: encodeBridgeValueForPage(chain, realPage) }
            );
          let nativeReferences = nativeLocatorReferences.get(realPage);
          if (!nativeReferences) {
            nativeReferences = new Map();
            nativeLocatorReferences.set(realPage, nativeReferences);
          }
          return references.map(({ id, selector }) => {
            nativeReferences.set(id, realPage.locator(selector));
            return createLocatorProxy(realPage, state, [
              ["__pwLiteLocatorRef", [id]],
            ]);
          });
        };
      }

      // page(): return the proxy page.
      if (prop === "page") {
        return () => createPageProxy(realPage, state);
      }

      // Only ledger-declared iframe members may use the native driver.
      // Rebuild a real Playwright locator from the recorded chain, or use the
      // native counterpart cached beside an actual runtime Locator.all() ref.
      if (isOutOfScope("Locator", prop)) {
        return (...args: unknown[]) => {
          nativeOperationLog(realPage).push(`Locator.${prop}`);
          const nativeTarget = nativeLocatorForChain(realPage, chain);
          const nativeMember = (nativeTarget as any)[prop];
          if (typeof nativeMember !== "function")
            throw new TypeError(`Native Locator.${prop} is not a function`);
          return wrapNativeResult(
            nativeMember.apply(nativeTarget, args),
            realPage
          );
        };
      }

      if (prop === "highlight") {
        return async (options?: Parameters<Locator["highlight"]>[0]) => {
          const id = await evaluateAdapter<string>(
            realPage,
            ({ chain: c, options: o }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const current = host.__pwLiteReplayAdapterChain(c);
                return host.__pwLiteStoreElementHandle(
                  await current.highlight(host.__pwLiteDecodeBridgeValue(o)),
                  "Disposable"
                );
              });
            },
            {
              chain: encodeBridgeValueForPage(chain, realPage),
              options: encodeBridgeValueForPage(options, realPage),
            }
          );
          return createHighlightDisposableProxy(realPage, id);
        };
      }

      if (prop === "elementHandle") {
        return async (options?: unknown) => {
          const id = await evaluateAdapter<string>(
            realPage,
            ({ chain: c, options: o }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const current: any = host.__pwLiteReplayAdapterChain(c);
                return host.__pwLiteStoreElementHandle(
                  await current.elementHandle(host.__pwLiteDecodeBridgeValue(o))
                );
              });
            },
            {
              chain: encodeBridgeValueForPage(chain, realPage),
              options: encodeBridgeValueForPage(options, realPage),
            }
          );
          return createElementHandleProxy(realPage, state, id);
        };
      }

      if (prop === "elementHandles") {
        return async () => {
          const ids = await evaluateAdapter<string[]>(
            realPage,
            ({ chain: c }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const current: any = host.__pwLiteReplayAdapterChain(c);
                return (await current.elementHandles()).map((handle: any) =>
                  host.__pwLiteStoreElementHandle(handle)
                );
              });
            },
            { chain: encodeBridgeValueForPage(chain, realPage) }
          );
          return Promise.all(
            ids.map((id) => createElementHandleProxy(realPage, state, id))
          );
        };
      }

      // Playwright's locator matchers call the private-shaped `_expect`
      // protocol. Route that protocol to LocatorImpl so the pinned
      // InjectedScript computes the matcher result, rather than allowing the
      // Node driver to inspect the locator.
      if (prop === "_expect") {
        return async (expression: string, options: Record<string, unknown>) =>
          evaluateAdapter(
            realPage,
            ({ chain: c, expression: e, options: o }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() => {
                const current: any = host.__pwLiteReplayAdapterChain(c);
                return current._expect(e, host.__pwLiteDecodeBridgeValue(o));
              });
            },
            {
              chain: encodeBridgeValueForPage(chain, realPage),
              expression,
              // AbortSignal is a client-side control object, not serializable.
              options: serializableExpectationOptions(
                encodeBridgeValueForPage(options, realPage) as Record<
                  string,
                  unknown
                >
              ),
            }
          );
      }

      // Reconstruct the caller's function at the fixture boundary. Production
      // evaluation remains responsible for serializing its source and values.
      if (prop === "evaluate" || prop === "evaluateAll") {
        return async (
          pageFunction: unknown,
          arg?: unknown,
          options?: unknown
        ) =>
          evaluateAdapter(
            realPage,
            ({ chain: c, method, expression, arg: a, options: o }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() => {
                const current: any = host.__pwLiteReplayAdapterChain(c);
                const callback = (0, eval)(`(${expression})`);
                const argument = host.__pwLiteDecodeBridgeValue(a);
                return method === "evaluateAll"
                  ? current.evaluateAll(callback, argument)
                  : current.evaluate(
                      callback,
                      argument,
                      host.__pwLiteDecodeBridgeValue(o)
                    );
              });
            },
            {
              chain: encodeBridgeValueForPage(chain, realPage),
              method: prop,
              expression: callbackSource(pageFunction, `Locator.${prop}`),
              arg: encodeBridgeValueForPage(arg, realPage),
              options: serializableQueryOptions(
                encodeBridgeValueForPage(options, realPage)
              ),
            }
          );
      }

      // Everything else: terminal evaluation in browser.
      return async (...args: unknown[]) =>
        withAbortSignalBridge(realPage, args, (encodedArgs) =>
          evaluateAdapter(
            realPage,
            ({ chain: c, method, args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() => {
                const current: any = host.__pwLiteReplayAdapterChain(c);
                return current[method](...host.__pwLiteDecodeBridgeValue(a));
              }, a);
            },
            {
              chain: encodeBridgeValueForPage(chain, realPage),
              method: prop as string,
              args: encodedArgs,
            }
          )
        );
    },
  };
  const proxy = new Proxy({}, handler);
  locatorProxyChains.set(proxy, chain);
  return proxy as unknown as Locator;
}

function serializableExpectationOptions(options: Record<string, unknown>) {
  const { signal: _signal, ...serializable } = options;
  return serializable;
}

function serializableQueryOptions(options: unknown) {
  if (!options || typeof options !== "object") return options;
  const { signal: _signal, ...serializable } = options as Record<
    string,
    unknown
  >;
  return serializable;
}

function initializeAdapterBridge(sabotagedMethod: string | null) {
  const host = window as any;
  host.__pwLiteEvidence = { entered: [], failures: [] };
  host.__pwLiteAbortSignals = new Map<string, AbortController>();
  host.__pwLitePendingAborts = new Map<string, unknown>();
  const abortReason = (value: any) => {
    if (value?.__pwLiteAbortError) {
      const error = new Error(value.message);
      error.name = value.name;
      return error;
    }
    return value;
  };
  host.__pwLiteAbortSignal = (id: string, reason: unknown) => {
    const controller = host.__pwLiteAbortSignals.get(id);
    if (controller && !controller.signal.aborted)
      controller.abort(abortReason(reason));
    else if (!controller) host.__pwLitePendingAborts.set(id, reason);
  };
  // The encoded options carry the bridged signal id, so an AbortError can be
  // compared against the very controller the adapter was given.
  const bridgedSignalId = (encodedArgs: any) => {
    const options = Array.isArray(encodedArgs)
      ? encodedArgs[encodedArgs.length - 1]
      : encodedArgs;
    const id = options?.signal?.__pwLiteAbortSignal;
    return typeof id === "string" ? id : undefined;
  };
  host.__pwLiteInvokeAdapter = async function invoke(
    operation: () => any,
    encodedArgs?: any
  ) {
    try {
      return { kind: "value", value: await operation() };
    } catch (error) {
      // Symbols do not cross the browser evaluation boundary. Preserve only
      // the adapter's stable timeout identity in a fixture-private sentinel;
      // all other errors continue through Playwright unchanged.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as Record<symbol, unknown>)[
          Symbol.for("playwright-lite:TimeoutError")
        ] === true
      )
        return {
          kind: "adapter-timeout",
          message: error instanceof Error ? error.message : String(error),
        };
      if (error instanceof Error && error.name === "AbortError") {
        // `cause` cannot cross the evaluation boundary by identity. Report
        // here, in the browser, whether the adapter's own error already
        // carried the abort reason it was given; only then may the Node side
        // restore that object's identity.
        const controller = host.__pwLiteAbortSignals.get(
          bridgedSignalId(encodedArgs)
        );
        return {
          kind: "adapter-error",
          name: error.name,
          message: error.message,
          causeMatchedAbortReason:
            !!controller &&
            controller.signal.aborted &&
            error.cause === controller.signal.reason,
        };
      }
      throw error;
    }
  };
  host.__pwLiteDecodeBridgeValue = function decode(value: any): any {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(decode);
    if (Array.isArray(value.__pwLiteBytes))
      return Uint8Array.from(value.__pwLiteBytes);
    if (typeof value.__pwLiteAbortSignal === "string") {
      let controller = host.__pwLiteAbortSignals.get(value.__pwLiteAbortSignal);
      if (!controller) {
        controller = new AbortController();
        host.__pwLiteAbortSignals.set(value.__pwLiteAbortSignal, controller);
      }
      const pending = host.__pwLitePendingAborts.get(value.__pwLiteAbortSignal);
      if (host.__pwLitePendingAborts.has(value.__pwLiteAbortSignal)) {
        host.__pwLitePendingAborts.delete(value.__pwLiteAbortSignal);
        if (!controller.signal.aborted) {
          const reason = abortReason(pending);
          // `value.aborted` is the Node-side state at the moment the API call
          // was made, which is what decides in-flight versus already-aborted
          // upstream: a signal aborted after the call was issued cancels a
          // call the server has already received. The forwarded abort can win
          // the race to the browser, so re-time it to that ordering instead of
          // letting transport scheduling turn an in-flight abort into an
          // already-aborted one. The adapter still has to observe the abort
          // and produce the error itself.
          if (value.aborted) controller.abort(reason);
          else
            queueMicrotask(() => {
              if (!controller.signal.aborted) controller.abort(reason);
            });
        }
      } else if (value.aborted && !controller.signal.aborted) {
        controller.abort(abortReason(value.reason));
      }
      return controller.signal;
    }
    if (typeof value.__pwLiteElementHandleRef === "string")
      return host.__pwLiteElementHandleForId(value.__pwLiteElementHandleRef);
    if (Array.isArray(value.__pwLiteLocatorChain))
      return host.__pwLiteReplayAdapterChain(value.__pwLiteLocatorChain);
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decode(item)])
    );
  };
  host.__pwLiteReplayAdapterChain = function replay(chain: any[]): any {
    let current: any = host.__pwLiteAdapterPage;
    for (const [method, args] of chain)
      current =
        method === "__pwLiteLocatorRef"
          ? host.__pwLiteLocators.get(args[0])
          : current[method](...host.__pwLiteDecodeBridgeValue(args));
    return current;
  };
  const wrapped = new WeakSet<object>();
  const instrument = (
    object: any,
    kind: string,
    members?: readonly string[]
  ): any => {
    if (!object || typeof object !== "object" || wrapped.has(object))
      return object;
    wrapped.add(object);
    const prototype = Object.getPrototypeOf(object);
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (
        name === "constructor" ||
        (members && !members.includes(name)) ||
        typeof Object.getOwnPropertyDescriptor(prototype, name)?.value !==
          "function"
      )
        continue;
      const original = object[name];
      const publicName =
        name === "_evaluateExpression"
          ? "evaluate"
          : name === "_waitForFunctionExpression"
            ? "waitForFunction"
            : name;
      object[name] = function (...args: unknown[]) {
        const recordedName = `${kind}.${publicName}`;
        host.__pwLiteEvidence.entered.push(recordedName);
        // Every adapter call the evidence records routes through here, so this
        // is the one place a promotion rerun can withhold a method from the
        // test that claims to prove it.
        if (recordedName === sabotagedMethod)
          throw new Error(
            `__pwLiteSabotagedMethod: ${recordedName} was withheld for promotion review.`
          );
        const result = original.apply(this, args);
        if (
          result &&
          typeof result.then !== "function" &&
          typeof result.count === "function"
        )
          instrument(result, "Locator");
        return result;
      };
    }
    return object;
  };
  instrument(host.__pwLiteAdapterPage, "Page");
  instrument(host.__pwLiteAdapterPage.keyboard, "Keyboard", [
    "down",
    "up",
    "press",
    "type",
    "insertText",
  ]);
  for (const kind of ["localStorage", "sessionStorage"])
    instrument(host.__pwLiteAdapterPage[kind], `Page.${kind}`, [
      "items",
      "getItem",
      "setItem",
      "removeItem",
      "clear",
    ]);
  host.__pwLiteElementHandles = new Map<string, any>();
  const handleContext =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  let nextElementHandleId = 0;
  host.__pwLiteLocators = new Map<string, any>();
  host.__pwLiteStoreLocator = function store(locator: any): {
    id: string;
    selector: string;
  } {
    if (typeof locator.selector !== "string")
      throw new Error(
        "Cannot preserve a native counterpart for a runtime Locator without a selector."
      );
    const id = `${handleContext}:locator-${++nextElementHandleId}`;
    host.__pwLiteLocators.set(id, instrument(locator, "Locator"));
    return { id, selector: locator.selector };
  };
  host.__pwLiteStoreElementHandle = function store(
    handle: any,
    kind = "ElementHandle"
  ): string | null {
    if (!handle) return null;
    const id = `${handleContext}:element-${++nextElementHandleId}`;
    host.__pwLiteElementHandles.set(id, instrument(handle, kind));
    return id;
  };
  host.__pwLiteElementHandleForId = function resolve(id: string): any {
    const handle = host.__pwLiteElementHandles.get(id);
    if (!handle)
      throw new Error(`Unknown or disposed adapter ElementHandle: ${id}`);
    return handle;
  };
  host.__pwLiteDisposeElementHandle = async function dispose(id: string) {
    const handle = host.__pwLiteElementHandles.get(id);
    if (!handle) return;
    await handle.dispose();
    host.__pwLiteElementHandles.delete(id);
  };
}
