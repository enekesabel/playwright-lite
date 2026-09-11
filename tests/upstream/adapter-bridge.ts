/**
 * Bridges the @ayme-dev/playwright-browser in-browser adapter with
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
const LOCATOR_CHAIN_PAYLOAD = "__aymeLocatorChain";
const ELEMENT_HANDLE_REF_PAYLOAD = "__aymeElementHandleRef";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";
type ChainStep = [string, unknown[]];
type AdapterPageState = { url: string };
type AdapterTimeoutDefaults = {
  actionTimeout?: number;
  navigationTimeout?: number;
};

const nativeLocatorReferences = new WeakMap<Page, Map<string, Locator>>();

function isOutOfScope(owner: "Page" | "Locator", member: string) {
  return statusFor(owner, member) === "out-of-scope";
}

function nativeOperationLog(realPage: Page) {
  return (realPage as any).__aymeNativeOperations as string[];
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
    if (method === "__aymeLocatorRef") {
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
  if (value instanceof Uint8Array) return { __aymeBytes: Array.from(value) };

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

function callbackSource(callback: unknown, operation: string): string {
  if (typeof callback !== "function")
    throw new TypeError(
      `${operation} requires a function callback in the upstream adapter bridge.`
    );
  return String(callback);
}

type BridgeEnvelope<Result> =
  | { kind: "value"; value: Result }
  | { kind: "adapter-timeout"; message: string };

const testIdAttributeSynchronizers = new WeakMap<Page, () => Promise<void>>();

type SelectorsWithWritableTestIdAttribute = Playwright["selectors"] & {
  setTestIdAttribute: (attributeName: string) => void;
};

/**
 * Mirrors Playwright's selectors.setTestIdAttribute propagation in the
 * fixture only. The compiled browser adapter reads this private window value;
 * production code has no Playwright transport dependency.
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
        window as Window & { __aymeTestIdAttributeName?: string }
      ).__aymeTestIdAttributeName = testIdAttributeName;
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
  synchronize(initialAttributeName);
  await synchronization;
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
    "window.__aymeAdapter = (function() {",
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
      ? `window.__aymeAdapterPage.setDefaultTimeout(${JSON.stringify(timeoutDefaults.actionTimeout)});`
      : "",
    typeof timeoutDefaults.navigationTimeout === "number"
      ? `window.__aymeAdapterPage.setDefaultNavigationTimeout(${JSON.stringify(timeoutDefaults.navigationTimeout)});`
      : "",
  ].join("\n");
  const adapterPageSetup =
    "\nwindow.builtins ??= {}; window.builtins.Date ??= window.Date;" +
    "\nwindow.__aymeAdapterPage = window.__aymeAdapter.createPage();" +
    `\n${configuredTimeouts}`;

  // Single init script: on every navigation, inject the adapter bundle
  // and create the adapter page from the current window.
  // W-28 AC1: deterministic single-script initialization.
  await realPage.addInitScript(bundle + adapterPageSetup);

  // Init scripts apply to future navigations. Execute the same bundle in the
  // page Playwright Test already created so its initial about:blank document
  // remains intact.
  await realPage.evaluate(
    (source) => (0, eval)(source),
    bundle + adapterPageSetup
  );

  await realPage.evaluate(() => {
    const host = window as any;
    host.__aymeEvidence = { entered: [], failures: [] };
    host.__aymeInvokeAdapter = async function invoke(operation: () => any) {
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
            Symbol.for("ayme:playwright-browser:TimeoutError")
          ] === true
        )
          return {
            kind: "adapter-timeout",
            message: error instanceof Error ? error.message : String(error),
          };
        throw error;
      }
    };
    host.__aymeDecodeBridgeValue = function decode(value: any): any {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(decode);
      if (Array.isArray(value.__aymeBytes))
        return Uint8Array.from(value.__aymeBytes);
      if (typeof value.__aymeElementHandleRef === "string")
        return host.__aymeElementHandleForId(value.__aymeElementHandleRef);
      if (Array.isArray(value.__aymeLocatorChain))
        return host.__aymeReplayAdapterChain(value.__aymeLocatorChain);
      if (Object.getPrototypeOf(value) !== Object.prototype) return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, decode(item)])
      );
    };
    host.__aymeReplayAdapterChain = function replay(chain: any[]): any {
      let current: any = host.__aymeAdapterPage;
      for (const [method, args] of chain)
        current =
          method === "__aymeLocatorRef"
            ? host.__aymeLocators.get(args[0])
            : current[method](...host.__aymeDecodeBridgeValue(args));
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
          host.__aymeEvidence.entered.push(`${kind}.${publicName}`);
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
    instrument(host.__aymeAdapterPage, "Page");
    instrument(host.__aymeAdapterPage.keyboard, "Keyboard", [
      "down",
      "up",
      "press",
      "type",
      "insertText",
    ]);
    host.__aymeElementHandles = new Map<string, any>();
    const handleContext =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    let nextElementHandleId = 0;
    host.__aymeLocators = new Map<string, any>();
    host.__aymeStoreLocator = function store(locator: any): {
      id: string;
      selector: string;
    } {
      if (typeof locator.selector !== "string")
        throw new Error(
          "Cannot preserve a native counterpart for a runtime Locator without a selector."
        );
      const id = `${handleContext}:locator-${++nextElementHandleId}`;
      host.__aymeLocators.set(id, instrument(locator, "Locator"));
      return { id, selector: locator.selector };
    };
    host.__aymeStoreElementHandle = function store(
      handle: any,
      kind = "ElementHandle"
    ): string | null {
      if (!handle) return null;
      const id = `${handleContext}:element-${++nextElementHandleId}`;
      host.__aymeElementHandles.set(id, instrument(handle, kind));
      return id;
    };
    host.__aymeElementHandleForId = function resolve(id: string): any {
      const handle = host.__aymeElementHandles.get(id);
      if (!handle)
        throw new Error(`Unknown or disposed adapter ElementHandle: ${id}`);
      return handle;
    };
    host.__aymeDisposeElementHandle = async function dispose(id: string) {
      const handle = host.__aymeElementHandles.get(id);
      if (!handle) return;
      await handle.dispose();
      host.__aymeElementHandles.delete(id);
    };
  });

  const evaluate = realPage.evaluate.bind(realPage);
  const failures: string[] = [];
  (realPage as any).__aymeTransportFailures = failures;
  (realPage as any).__aymeNativeOperations = [] as string[];
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
    url: await evaluateAdapter(
      realPage,
      () => {
        const host = window as any;
        return host.__aymeInvokeAdapter(() => host.__aymeAdapterPage.url());
      },
      undefined
    ),
  };
  return createPageProxy(realPage, state);
}

function createPageProxy(realPage: Page, state: AdapterPageState): Page {
  return new Proxy(realPage, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (prop === "__aymeAdapter") return true;
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
        return async (selector: string, options?: unknown) => {
          const id = await evaluateAdapter<string | null>(
            realPage,
            ({ method, selector: s, options: o }) => {
              const host = window as any;
              return host.__aymeInvokeAdapter(async () =>
                host.__aymeStoreElementHandle(
                  await host.__aymeAdapterPage[method](
                    s,
                    host.__aymeDecodeBridgeValue(o)
                  )
                )
              );
            },
            {
              method: prop,
              selector,
              options: encodeBridgeValueForPage(options, realPage),
            }
          );
          return id ? createElementHandleProxy(realPage, state, id) : null;
        };
      }

      if (prop === "$$") {
        return async (selector: string) => {
          const ids = await evaluateAdapter<string[]>(
            realPage,
            ({ selector: s }) => {
              const host = window as any;
              return host.__aymeInvokeAdapter(async () =>
                (await host.__aymeAdapterPage.$$(s)).map((handle: any) =>
                  host.__aymeStoreElementHandle(handle)
                )
              );
            },
            { selector }
          );
          return ids.map((id) => createElementHandleProxy(realPage, state, id));
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
              return host.__aymeInvokeAdapter(async () => {
                const callback = isFunction
                  ? (0, eval)(`(${expression})`)
                  : expression;
                return {
                  value: await host.__aymeAdapterPage.evaluate(
                    callback,
                    host.__aymeDecodeBridgeValue(a)
                  ),
                  url: host.__aymeAdapterPage.url(),
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
              return host.__aymeInvokeAdapter(async () => {
                const handle = await host.__aymeAdapterPage.waitForFunction(
                  isFunction ? (0, eval)(`(${expression})`) : expression,
                  host.__aymeDecodeBridgeValue(a),
                  host.__aymeDecodeBridgeValue(opts)
                );
                return host.__aymeStoreElementHandle(handle, "JSHandle");
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
              return host.__aymeInvokeAdapter(() =>
                host.__aymeAdapterPage[method](
                  s,
                  (0, eval)(`(${expression})`),
                  host.__aymeDecodeBridgeValue(a)
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
      return async (...args: unknown[]) => {
        const result = await evaluateAdapter<{ value: unknown; url: string }>(
          realPage,
          ({ member, args: a }) => {
            const host = window as any;
            return host.__aymeInvokeAdapter(async () => {
              const p = host.__aymeAdapterPage;
              const v = p[member];
              const args = host.__aymeDecodeBridgeValue(a);
              let value: unknown;
              if (typeof v === "function") value = await v.call(p, ...args);
              else if (a.length === 0 && v !== undefined) value = v;
              else
                throw new TypeError(
                  `__aymeAdapterPage.${member} is not a function`
                );
              return { value, url: p.url() };
            });
          },
          {
            member: prop,
            args: encodeBridgeValueForPage(args, realPage) as any[],
          }
        );
        state.url = result.url;
        return result.value;
      };
    },
  }) as Page;
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
        return host.__aymeInvokeAdapter(() =>
          host.__aymeAdapterPage.keyboard[member](
            ...host.__aymeDecodeBridgeValue(rawArgs)
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

function createElementHandleProxy(
  realPage: Page,
  state: AdapterPageState,
  id: string
): object {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "__aymeAdapter") return true;
      if (prop === "then") return undefined;

      if (prop === "dispose") {
        return async () =>
          evaluateAdapter(
            realPage,
            (handleId) => {
              const host = window as any;
              return host.__aymeInvokeAdapter(() =>
                host.__aymeDisposeElementHandle(handleId)
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
              return host.__aymeInvokeAdapter(async () =>
                host.__aymeStoreElementHandle(
                  await host
                    .__aymeElementHandleForId(handleId)
                    [method](s, host.__aymeDecodeBridgeValue(o))
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
              return host.__aymeInvokeAdapter(async () =>
                (await host.__aymeElementHandleForId(handleId).$$(s)).map(
                  (handle: any) => host.__aymeStoreElementHandle(handle)
                )
              );
            },
            { handleId: id, selector }
          );
          return ids.map((childId) =>
            createElementHandleProxy(realPage, state, childId)
          );
        };
      }

      if (prop === "$eval" || prop === "$$eval") {
        return async (selector: string, pageFunction: unknown, arg?: unknown) =>
          evaluateAdapter(
            realPage,
            ({ handleId, method, selector: s, expression, arg: a }) => {
              const host = window as any;
              return host.__aymeInvokeAdapter(() =>
                host
                  .__aymeElementHandleForId(handleId)
                  [method](
                    s,
                    (0, eval)(`(${expression})`),
                    host.__aymeDecodeBridgeValue(a)
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
              return host.__aymeInvokeAdapter(() =>
                host
                  .__aymeElementHandleForId(handleId)
                  [method](
                    (0, eval)(`(${expression})`),
                    host.__aymeDecodeBridgeValue(a)
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
            return host.__aymeInvokeAdapter(() =>
              host
                .__aymeElementHandleForId(handleId)
                [method](...host.__aymeDecodeBridgeValue(a))
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
      if (prop === "__aymeAdapter") return true;
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
                return host.__aymeInvokeAdapter(async () => {
                  const current: any = host.__aymeReplayAdapterChain(c);
                  return (await current.all()).map((locator: any) =>
                    host.__aymeStoreLocator(locator)
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
              ["__aymeLocatorRef", [id]],
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

      if (prop === "elementHandle") {
        return async (options?: unknown) => {
          const id = await evaluateAdapter<string>(
            realPage,
            ({ chain: c, options: o }) => {
              const host = window as any;
              return host.__aymeInvokeAdapter(async () => {
                const current: any = host.__aymeReplayAdapterChain(c);
                return host.__aymeStoreElementHandle(
                  await current.elementHandle(host.__aymeDecodeBridgeValue(o))
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
              return host.__aymeInvokeAdapter(async () => {
                const current: any = host.__aymeReplayAdapterChain(c);
                return (await current.elementHandles()).map((handle: any) =>
                  host.__aymeStoreElementHandle(handle)
                );
              });
            },
            { chain: encodeBridgeValueForPage(chain, realPage) }
          );
          return ids.map((id) => createElementHandleProxy(realPage, state, id));
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
              return host.__aymeInvokeAdapter(() => {
                const current: any = host.__aymeReplayAdapterChain(c);
                return current._expect(e, host.__aymeDecodeBridgeValue(o));
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

      // The production Locator receives a function already in the browser
      // runtime. Reconstruct the Node callback only at this fixture boundary.
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
              return host.__aymeInvokeAdapter(() => {
                const current: any = host.__aymeReplayAdapterChain(c);
                return current[method](
                  (0, eval)(`(${expression})`),
                  host.__aymeDecodeBridgeValue(a),
                  host.__aymeDecodeBridgeValue(o)
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
        evaluateAdapter(
          realPage,
          ({ chain: c, method, args: a }) => {
            const host = window as any;
            return host.__aymeInvokeAdapter(() => {
              const current: any = host.__aymeReplayAdapterChain(c);
              return current[method](...host.__aymeDecodeBridgeValue(a));
            });
          },
          {
            chain: encodeBridgeValueForPage(chain, realPage),
            method: prop as string,
            args: encodeBridgeValueForPage(args, realPage) as any[],
          }
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
