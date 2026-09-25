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
  type Disposable,
  type Locator,
  type Page,
  type Playwright,
} from "@playwright/test";
import {
  formatLocatorChainDescription,
  locatorDescription,
} from "./locatorChainDescription";
import { statusFor } from "../../compatibility/api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIST_PATH = resolve(__dirname, "../../dist/index.mjs");
const LOCATOR_CHAIN_PAYLOAD = "__pwLiteLocatorChain";
const ELEMENT_HANDLE_REF_PAYLOAD = "__pwLiteElementHandleRef";
const NETWORK_REF_PAYLOAD = "__pwLiteNetworkRef";
const NETWORK_BYTES_PAYLOAD = "__pwLiteNetworkBytes";
const CONSOLE_MESSAGE_REF_PAYLOAD = "__pwLiteConsoleMessageRef";
const ABORT_SIGNAL_PAYLOAD = "__pwLiteAbortSignal";
const FUNCTION_SOURCE_PAYLOAD = "__pwLiteFunctionSource";
const TYPED_ARRAY_PAYLOAD = "__pwLiteTypedArray";
const NATIVE_RESULT_MARKER = "__pwLiteNativeResult";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";
/**
 * Playwright rejects `page.evaluate` with the calling API name followed by the
 * browser's description of what the page function threw, whose first line is
 * the first line of that error's `stack`.
 */
const EVALUATE_ERROR_PREFIX = "page.evaluate: ";

/**
 * The pinned protocol serializer's typed-array vocabulary
 * (playwright-core `protocol/serializers`: `typedArrayKindToConstructor`).
 * Reused here so a typed array keeps its element kind across the fixture's
 * `realPage.evaluate` boundary, which cannot carry a Node `Buffer` view.
 */
const TYPED_ARRAY_KINDS = [
  ["i8", Int8Array],
  ["ui8", Uint8Array],
  ["ui8c", Uint8ClampedArray],
  ["i16", Int16Array],
  ["ui16", Uint16Array],
  ["i32", Int32Array],
  ["ui32", Uint32Array],
  ["f32", Float32Array],
  ["f64", Float64Array],
  ["bi64", BigInt64Array],
  ["bui64", BigUint64Array],
] as const;
let nextAbortSignalId = 0;
type ChainStep = [string, unknown[]];
type AdapterPageState = {
  url: string;
  nativeNavigationForSetup?: boolean;
  // Set once `createPageProxy` has built this test's Page proxy. A
  // `ConsoleMessage.page()` republishes this reference rather than building
  // a new one, since every message this test observes belongs to the one
  // page the adapter bridge creates.
  pageProxy?: Page;
};

type AdapterPageReference = {
  realPage: Page;
  state: AdapterPageState;
};

const adapterPageReferences = new WeakMap<object, AdapterPageReference>();
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
  // Fixture-only public-expect matcher sabotage used by trust guards and
  // reviewed expect promotion reruns.
  sabotagedMatcher?: string;
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
      if (prop === NATIVE_RESULT_MARKER) return true;
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
const locatorChainRealPages = new WeakMap<object, Page>();
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
  // Functions cannot cross realPage.evaluate. Carry the caller's source so the
  // browser can rebuild the same function and hand it to the adapter, which
  // decides what a function in this position means — including rejecting it.
  if (typeof value === "function")
    return { [FUNCTION_SOURCE_PAYLOAD]: String(value) };
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
  const typedArrayKind = TYPED_ARRAY_KINDS.find(
    ([, constructor]) => value instanceof constructor
  )?.[0];
  if (typedArrayKind) {
    const view = value as ArrayBufferView;
    return {
      [TYPED_ARRAY_PAYLOAD]: {
        k: typedArrayKind,
        b: Array.from(
          new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        ),
      },
    };
  }

  if (Array.isArray(value)) {
    const encoded: unknown[] = [];
    seen.set(value, encoded);
    for (const item of value)
      encoded.push(encodeBridgeValue(item, seen, ownerPage));
    return encoded;
  }

  // Playwright's own protocol serializer already carries these across
  // realPage.evaluate with their identity intact, exactly as it does for a
  // client-side evaluate argument, so they travel unchanged.
  if (
    value instanceof RegExp ||
    value instanceof Date ||
    value instanceof URL ||
    value instanceof Error
  )
    return value;
  // A live Playwright driver object reached the test through an out-of-scope
  // native member. This single-document adapter cannot make its identity
  // meaningful, and copying one only yields more wrapped driver objects.
  if ((value as Record<string, unknown>)[NATIVE_RESULT_MARKER])
    throw new TypeError(
      "The upstream adapter bridge does not support native Playwright handles or frames as arguments."
    );
  // Anything else travels as its own enumerable string-keyed properties, which
  // is the pinned serializer's object branch: a Map arrives as `{}` and a
  // `__proto__`-poisoned literal arrives without that prototype.
  const encoded: Record<string, unknown> = {};
  seen.set(value, encoded);
  for (const [key, item] of Object.entries(value))
    encoded[key] = encodeBridgeValue(item, seen, ownerPage);
  return encoded;
}

function encodeBridgeValueForPage(value: unknown, realPage: Page): unknown {
  return encodeBridgeValue(value, new WeakMap<object, unknown>(), realPage);
}

/**
 * Republishes the handles a member returned. An adapter handle cannot cross
 * `realPage.evaluate` by value, so the browser side stores every handle it
 * finds in a result and sends back a reference envelope; here each reference
 * becomes a handle proxy, the same object a dedicated route returns. Arrays
 * travel element by element, which is the shape `$$`-like members return.
 */
async function decodeBridgeResult(
  value: unknown,
  realPage: Page,
  state: AdapterPageState
): Promise<unknown> {
  if (Array.isArray(value))
    return Promise.all(
      value.map((item) => decodeBridgeResult(item, realPage, state))
    );
  if (!value || typeof value !== "object") return value;
  if (
    typeof (value as Record<string, unknown>)[NETWORK_REF_PAYLOAD] === "string"
  )
    return createNetworkProxy(realPage, state, value as EncodedNetworkObject);
  if ((value as Record<string, unknown>)[CONSOLE_MESSAGE_REF_PAYLOAD] === true)
    return createConsoleMessageProxy(
      realPage,
      state,
      value as EncodedConsoleMessage
    );
  const reference = (value as Record<string, unknown>)[
    ELEMENT_HANDLE_REF_PAYLOAD
  ];
  return typeof reference === "string"
    ? createElementHandleProxy(realPage, state, reference)
    : value;
}

type EncodedConsoleMessage = {
  [CONSOLE_MESSAGE_REF_PAYLOAD]: true;
  type: string;
  text: string;
  timestamp: number;
  location: {
    url: string;
    line: number;
    column: number;
    lineNumber: number;
    columnNumber: number;
  };
  // Whether the reported message's own page() is the adapter page this
  // bridge created, read from the message itself rather than assumed; see
  // `__pwLiteStoreConsoleMessage`.
  page: boolean;
  // Read from the message itself, not assumed; always null today, since this
  // observation has no worker realm to report.
  worker: null;
  // Each element is a handle reference envelope, the same shape
  // `__pwLiteEncodeAdapterResult` gives any other adapter handle.
  args: unknown[];
};

/**
 * Republishes a `ConsoleMessage` the adapter reported. Every pinned member is
 * synchronous, so the browser side snapshots them all when the message
 * crosses the boundary and this proxy replays the snapshot; only `args()`
 * still needs a round trip, to turn its stored handle references into the
 * same handle proxies a dedicated route returns. `page()` answers with this
 * test's one Page proxy when the message's own `page()` was that adapter
 * page (read in the browser, not assumed here), `null` otherwise.
 */
async function createConsoleMessageProxy(
  realPage: Page,
  state: AdapterPageState,
  encoded: EncodedConsoleMessage
): Promise<object> {
  const args = (await decodeBridgeResult(
    encoded.args,
    realPage,
    state
  )) as unknown[];
  return {
    __pwLiteAdapter: true,
    args: () => args,
    location: () => encoded.location,
    page: () => (encoded.page ? state.pageProxy : null),
    text: () => encoded.text,
    timestamp: () => encoded.timestamp,
    type: () => encoded.type,
    worker: () => encoded.worker,
  };
}

type EncodedNetworkObject = {
  [NETWORK_REF_PAYLOAD]: string;
  kind: "Request" | "Response";
  snapshot: Record<string, { value?: unknown } | { error: string }>;
  request?: EncodedNetworkObject;
};

/**
 * Republishes a Request or Response the adapter reported.
 *
 * Playwright's Request and Response answer most members synchronously, which
 * no `realPage.evaluate` round trip can do, so the browser side snapshots
 * those members when it stores the object and this proxy replays the
 * snapshot. Members that are asynchronous in Playwright too round-trip to the
 * live object. The snapshot is taken when the object crosses the boundary, so
 * a value that changes afterwards, such as `failure()` between `request` and
 * `requestfailed`, is the value at the event that delivered it.
 */
function createNetworkProxy(
  realPage: Page,
  state: AdapterPageState,
  encoded: EncodedNetworkObject
): object {
  const request = encoded.request
    ? createNetworkProxy(realPage, state, encoded.request)
    : undefined;
  const invoke = async (member: string, args: unknown[]) =>
    decodeBridgeResult(
      await evaluateAdapter(
        realPage,
        ({ id, kind, member: name, args: a }) => {
          const host = window as any;
          return host.__pwLiteInvokeAdapter(async () =>
            host.__pwLiteEncodeAdapterResult(
              await host.__pwLiteNetworkCall(id, kind, name, a)
            )
          );
        },
        {
          id: encoded[NETWORK_REF_PAYLOAD],
          kind: encoded.kind,
          member,
          args: encodeBridgeValueForPage(args, realPage) as unknown[],
        }
      ),
      realPage,
      state
    );

  return new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (prop === "__pwLiteAdapter") return true;
        if (prop === "request" && request) return () => request;
        if (Object.hasOwn(encoded.snapshot, prop)) {
          const recorded = encoded.snapshot[prop];
          return () => {
            if ("error" in recorded) throw new Error(recorded.error);
            return decodeNetworkValue(recorded.value);
          };
        }
        return (...args: unknown[]) => invoke(prop, args);
      },
    }
  );
}

/** Byte payloads travel as plain arrays; the adapter returns typed arrays. */
function decodeNetworkValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const bytes = (value as Record<string, unknown>)[NETWORK_BYTES_PAYLOAD];
  return Array.isArray(bytes) ? Uint8Array.from(bytes as number[]) : value;
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

function encodePageFunction(callback: unknown, operation: string): unknown {
  if (typeof callback !== "function" && typeof callback !== "string")
    throw new TypeError(
      `${operation} requires a function or string callback in the upstream adapter bridge.`
    );
  return encodeBridgeValue(callback);
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
    "return { createPage: createPage, expect: expect };",
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
    `\n(${installBuiltins.toString()})();` +
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
    )}, ${JSON.stringify(timeoutDefaults.sabotagedMatcher ?? null)});`;

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
  // The message only selects the failures worth asking about: an error the
  // adapter or its page code raised can read exactly like a transport failure,
  // so the browser side, which saw where it was thrown, decides.
  const raisedByAdapter = async (firstLine: string) =>
    firstLine.startsWith(EVALUATE_ERROR_PREFIX) &&
    (await evaluate(
      (line) => (window as any).__pwLiteClaimAdapterError?.(line) === true,
      firstLine.slice(EVALUATE_ERROR_PREFIX.length)
    ).catch(() => false));
  realPage.evaluate = (async (...args: any[]) => {
    try {
      return await (evaluate as any)(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const firstLine = message.split("\n")[0];
      if (
        /is not a function|serializ|execution context|target.*closed/i.test(
          message
        )
      ) {
        // Recorded before the browser is asked, so evidence read while the
        // question is still open (a call nothing awaited, at teardown) keeps
        // the failure rather than losing it.
        failures.push(firstLine);
        if (await raisedByAdapter(firstLine)) {
          const index = failures.lastIndexOf(firstLine);
          if (index !== -1) failures.splice(index, 1);
        }
      }
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

  // Route a member through the adapter page in the browser. Both method calls
  // and property accesses go through the adapter so that unsupported members
  // (keyboard, mouse, touchscreen, etc.) are never leaked from the real
  // Playwright driver.
  const adapterMember =
    (member: string) =>
    async (...args: unknown[]) =>
      withAbortSignalBridge(realPage, args, async (encodedArgs) => {
        const result = await evaluateAdapter<{ value: unknown; url: string }>(
          realPage,
          ({ member: name, args: a }) => {
            const host = window as any;
            return host.__pwLiteInvokeAdapter(async () => {
              const p = host.__pwLiteAdapterPage;
              const v = p[name];
              let value: unknown;
              // Arguments are rebuilt only for a member the adapter has, so a
              // missing member is reported as such instead of as a transport
              // failure while reconstructing what it would have received.
              if (typeof v === "function")
                value = await v.call(p, ...host.__pwLiteDecodeBridgeValue(a));
              else if (a.length === 0 && v !== undefined) value = v;
              else
                throw new TypeError(
                  `__pwLiteAdapterPage.${name} is not a function`
                );
              return {
                value: host.__pwLiteEncodeAdapterResult(value),
                url: p.url(),
              };
            }, a);
          },
          { member, args: encodedArgs as any[] }
        );
        state.url = result.url;
        return decodeBridgeResult(result.value, realPage, state);
      });

  const proxy = new Proxy(realPage, {
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

      // Explicit fixture setup, never fallback after an adapter failure. Only
      // opted-in spec files reach this branch, and only until the test first
      // enters the adapter: a `goto` issued after that is no longer document
      // setup, so it routes through the adapter like any other member and can
      // fail there. Every native navigation is recorded and cannot certify
      // Page.goto compatibility.
      if (prop === "goto" && state.nativeNavigationForSetup) {
        return async (...args: Parameters<Page["goto"]>) => {
          const previous = await realPage.evaluate(
            () => (window as any).__pwLiteEvidence
          );
          // The bridge reads Page.url after every adapter operation and once
          // when the adapter page is created, to keep the synchronous url()
          // facade honest. Those reads are the bridge's own bookkeeping, not
          // operations the test performed.
          const enteredByTest = (previous.entered as string[]).filter(
            (member) => member !== "Page.url"
          );
          if (enteredByTest.length > 0) return adapterMember("goto")(...args);
          nativeOperationLog(realPage).push("Page.goto");
          const response = await realPage.goto(...args);
          await realPage.evaluate((prior) => {
            const current = (window as any).__pwLiteEvidence;
            current.entered.unshift(...prior.entered);
            current.expect.unshift(...(prior.expect ?? []));
            current.expectPaths.unshift(...(prior.expectPaths ?? []));
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

      // The returned Disposable's members cannot cross realPage.evaluate:
      // keep the adapter's own object in the browser and route its disposal
      // there. The callback travels as source, like any bridged function.
      if (prop === "exposeFunction" || prop === "exposeBinding") {
        return async (...args: unknown[]) => {
          const id = await evaluateAdapter<string>(
            realPage,
            ({ member, args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(
                async () =>
                  host.__pwLiteStoreElementHandle(
                    await host.__pwLiteAdapterPage[member](
                      ...host.__pwLiteDecodeBridgeValue(a)
                    ),
                    "Disposable"
                  ),
                a
              );
            },
            {
              member: prop,
              args: encodeBridgeValueForPage(args, realPage) as unknown[],
            }
          );
          return createDisposableProxy(realPage, id);
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
                  ? host.__pwLiteReconstructFunction(expression)
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

      if (prop === "evaluateHandle") {
        return async (pageFunction: unknown, arg?: unknown) => {
          const result = await evaluateAdapter<{ id: string; url: string }>(
            realPage,
            ({ expression, isFunction, arg: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => ({
                id: host.__pwLiteStoreElementHandle(
                  await host.__pwLiteAdapterPage.evaluateHandle(
                    isFunction
                      ? host.__pwLiteReconstructFunction(expression)
                      : expression,
                    host.__pwLiteDecodeBridgeValue(a)
                  )
                ),
                url: host.__pwLiteAdapterPage.url(),
              }));
            },
            {
              expression: String(pageFunction),
              isFunction: typeof pageFunction === "function",
              arg: encodeBridgeValueForPage(arg, realPage),
            }
          );
          state.url = result.url;
          return createElementHandleProxy(realPage, state, result.id);
        };
      }

      if (prop === "waitForFunction") {
        return async (
          pageFunction: unknown,
          arg?: unknown,
          options?: unknown
        ) => {
          const result = await evaluateAdapter<{ id: string; url: string }>(
            realPage,
            ({ expression, isFunction, arg: a, options: opts }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () => {
                const handle = await host.__pwLiteAdapterPage.waitForFunction(
                  isFunction
                    ? host.__pwLiteReconstructFunction(expression)
                    : expression,
                  host.__pwLiteDecodeBridgeValue(a),
                  host.__pwLiteDecodeBridgeValue(opts)
                );
                return {
                  id: host.__pwLiteStoreElementHandle(handle),
                  url: host.__pwLiteAdapterPage.url(),
                };
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
          state.url = result.url;
          return createElementHandleProxy(realPage, state, result.id);
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
                  host.__pwLiteDecodeBridgeValue(expression),
                  host.__pwLiteDecodeBridgeValue(a)
                )
              );
            },
            {
              method: prop,
              selector,
              expression: encodePageFunction(pageFunction, `Page.${prop}`),
              arg: encodeBridgeValueForPage(arg, realPage),
            }
          );
      }

      // Everything else: route through the adapter page in the browser.
      return adapterMember(prop);
    },
  }) as Page;
  adapterPageReferences.set(proxy as unknown as object, { realPage, state });
  state.pageProxy ??= proxy;
  return proxy;
}

export function isAdapterExpectationTarget(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (adapterPageReferences.has(value) || locatorProxyChains.has(value))
  );
}

type PublicExpectInvocation = {
  matcher: string;
  args: unknown[];
  isNot?: boolean;
  messageOrOptions?: string | { message?: string };
  configuration?: { message?: string; timeout?: number; soft?: boolean };
};

type SerializedExpectationError = {
  name: string;
  message: string;
  matcherResult?: unknown;
};

export async function runPublicExpectMatcher(
  actual: unknown,
  invocation: PublicExpectInvocation
): Promise<void> {
  if (!actual || typeof actual !== "object")
    throw new TypeError(
      "Public expect bridge requires an adapter Page or Locator."
    );

  const pageReference = adapterPageReferences.get(actual);
  const locatorChain = locatorProxyChains.get(actual);
  const realPage = pageReference?.realPage ?? locatorChainRealPages.get(actual);
  if (!realPage)
    throw new TypeError(
      "Public expect bridge received an unknown adapter receiver."
    );

  const target = pageReference
    ? { kind: "Page" as const }
    : {
        kind: "Locator" as const,
        chain: encodeBridgeValueForPage(locatorChain, realPage),
      };

  return withAbortSignalBridge(
    realPage,
    invocation.args,
    async (encodedArgs) => {
      const result = await evaluateAdapter<
        { ok: true } | { ok: false; error: SerializedExpectationError }
      >(
        realPage,
        ({
          target: receiver,
          matcher,
          args,
          isNot,
          messageOrOptions,
          configuration,
        }) => {
          const host = window as any;
          return host.__pwLiteInvokeAdapter(async () => {
            const actual =
              receiver.kind === "Page"
                ? host.__pwLiteAdapterPage
                : host.__pwLiteReplayAdapterChain(
                    host.__pwLiteDecodeBridgeValue(receiver.chain)
                  );
            const recordedName = `${receiver.kind}.${matcher}`;
            host.__pwLiteEvidence.expect.push(recordedName);
            if (recordedName === host.__pwLiteSabotagedMatcher) {
              // A withheld matcher produces no result. Its marker is the only
              // text a test can read from the failure, in the thrown message
              // and in each text field of `matcherResult`, so a test that
              // inspects the result still fails on the marker.
              const withheld = `__pwLiteSabotagedMatcher: ${recordedName} was withheld for promotion review.`;
              return {
                ok: false,
                error: {
                  name: "Error",
                  message: withheld,
                  matcherResult: {
                    message: withheld,
                    ariaSnapshot: withheld,
                    log: [withheld],
                  },
                },
              } as const;
            }

            const configured = configuration
              ? host.__pwLiteAdapter.expect.configure(configuration)
              : host.__pwLiteAdapter.expect;
            const matchers = configured(
              actual,
              host.__pwLiteDecodeBridgeValue(messageOrOptions)
            );
            try {
              const previousMatcher = host.__pwLiteActiveExpectMatcher;
              let assertion;
              host.__pwLiteActiveExpectMatcher = recordedName;
              try {
                assertion = (isNot ? matchers.not : matchers)[matcher](
                  ...host.__pwLiteDecodeBridgeValue(args)
                );
              } finally {
                host.__pwLiteActiveExpectMatcher = previousMatcher;
              }
              await assertion;
              return { ok: true } as const;
            } catch (error) {
              if (!(error instanceof Error)) throw error;
              return {
                ok: false,
                error: {
                  name: error.name,
                  message: error.message,
                  matcherResult: (error as any).matcherResult,
                },
              } as const;
            }
          }, args);
        },
        {
          target,
          matcher: invocation.matcher,
          args: encodedArgs,
          isNot: invocation.isNot,
          messageOrOptions: encodeBridgeValueForPage(
            invocation.messageOrOptions,
            realPage
          ),
          configuration: invocation.configuration,
        }
      );

      if (!result.ok) {
        const error = new Error(result.error.message);
        error.name = result.error.name;
        if (result.error.matcherResult !== undefined)
          Object.defineProperty(error, "matcherResult", {
            configurable: true,
            value: result.error.matcherResult,
          });
        throw error;
      }
    }
  );
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
  // Like Page.url(), these synchronous APIs need a browser-observed snapshot.
  // Read the actual identity result and the handle's own description before
  // publishing the proxy; do not assume every stored JSHandle is an
  // ElementHandle or manufacture a passing result.
  const { asElement, description } = await evaluateAdapter<{
    asElement: "self" | "null" | "unsupported";
    description: string;
  }>(
    realPage,
    (handleId) => {
      const host = window as any;
      return host.__pwLiteInvokeAdapter(() => {
        const handle = host.__pwLiteElementHandleForId(handleId);
        const description = String(handle);
        if (typeof handle.asElement !== "function")
          return { asElement: "unsupported", description };
        const element = handle.asElement();
        if (element === handle) return { asElement: "self", description };
        if (element === null) return { asElement: "null", description };
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
      // JSHandle.toString() is synchronous in Playwright's public API, so it
      // replays the description the adapter gave when the handle was created.
      if (prop === "toString") return () => description;

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

      // A property handle is another adapter handle, so it is stored and
      // republished as a proxy instead of being serialized by value.
      if (prop === "getProperty") {
        return async (name: string) => {
          const propertyId = await evaluateAdapter<string>(
            realPage,
            ({ handleId, name: propertyName }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                host.__pwLiteStoreElementHandle(
                  await host
                    .__pwLiteElementHandleForId(handleId)
                    .getProperty(propertyName)
                )
              );
            },
            { handleId: id, name }
          );
          return createElementHandleProxy(realPage, state, propertyId);
        };
      }

      // So is the handle evaluateHandle answers. The caller's arguments travel
      // as they were given, so the adapter applies its own argument rules.
      if (prop === "evaluateHandle") {
        return async (...args: unknown[]) => {
          const resultId = await evaluateAdapter<string>(
            realPage,
            ({ handleId, args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                host.__pwLiteStoreElementHandle(
                  await host
                    .__pwLiteElementHandleForId(handleId)
                    .evaluateHandle(...host.__pwLiteDecodeBridgeValue(a))
                )
              );
            },
            {
              handleId: id,
              args: encodeBridgeValueForPage(args, realPage) as unknown[],
            }
          );
          return createElementHandleProxy(realPage, state, resultId);
        };
      }

      if (prop === "getProperties") {
        return async () => {
          const references = await evaluateAdapter<[string, string][]>(
            realPage,
            (handleId) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                Array.from(
                  await host
                    .__pwLiteElementHandleForId(handleId)
                    .getProperties(),
                  ([name, handle]: [string, unknown]) => [
                    name,
                    host.__pwLiteStoreElementHandle(handle),
                  ]
                )
              );
            },
            id
          );
          return new Map(
            await Promise.all(
              references.map(
                async ([name, propertyId]) =>
                  [
                    name,
                    await createElementHandleProxy(realPage, state, propertyId),
                  ] as const
              )
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
                    host.__pwLiteDecodeBridgeValue(expression),
                    host.__pwLiteDecodeBridgeValue(a)
                  )
              );
            },
            {
              handleId: id,
              method: prop,
              selector,
              expression: encodePageFunction(
                pageFunction,
                `ElementHandle.${prop}`
              ),
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
                    host.__pwLiteDecodeBridgeValue(expression),
                    host.__pwLiteDecodeBridgeValue(a)
                  )
              );
            },
            {
              handleId: id,
              method: prop,
              expression: encodePageFunction(
                pageFunction,
                `ElementHandle.${prop}`
              ),
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

/**
 * Republishes a `Disposable` an adapter member returned (`Locator.highlight`,
 * `Page.exposeFunction`, `Page.exposeBinding`). Its members cannot cross
 * `realPage.evaluate`, so the browser side stores the adapter's own object.
 */
function createDisposableProxy(realPage: Page, id: string): Disposable {
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
          return createDisposableProxy(realPage, id);
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

      // The handle evaluateHandle answers is an adapter handle, stored and
      // republished as a proxy under the kind its value gives it. The caller's
      // arguments travel as they were given, like any other Locator member.
      if (prop === "evaluateHandle") {
        return async (...args: unknown[]) =>
          withAbortSignalBridge(realPage, args, async (encodedArgs) => {
            const id = await evaluateAdapter<string>(
              realPage,
              ({ chain: c, args: a }) => {
                const host = window as any;
                return host.__pwLiteInvokeAdapter(async () => {
                  const current: any = host.__pwLiteReplayAdapterChain(c);
                  return host.__pwLiteStoreElementHandle(
                    await current.evaluateHandle(
                      ...host.__pwLiteDecodeBridgeValue(a)
                    )
                  );
                }, a);
              },
              {
                chain: encodeBridgeValueForPage(chain, realPage),
                args: encodedArgs,
              }
            );
            return createElementHandleProxy(realPage, state, id);
          });
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
                const callback = host.__pwLiteDecodeBridgeValue(expression);
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
              expression: encodePageFunction(pageFunction, `Locator.${prop}`),
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
  locatorChainRealPages.set(proxy, realPage);
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

/**
 * Upstream's injected utility script publishes the document's own timers,
 * `performance`, `Date` and friends as `window.builtins` while under test, so
 * a spec can schedule work that page-installed clocks cannot replace
 * (`packages/injected/src/utilityScript.ts`, pinned commit 26a9e47). This
 * package has no utility script, so the fixture performs the same install,
 * with the same members bound to the same window, before the test runs.
 */
function installBuiltins() {
  const host = window;
  (host as any).builtins = {
    setTimeout: host.setTimeout?.bind(host),
    clearTimeout: host.clearTimeout?.bind(host),
    setInterval: host.setInterval?.bind(host),
    clearInterval: host.clearInterval?.bind(host),
    requestAnimationFrame: host.requestAnimationFrame?.bind(host),
    cancelAnimationFrame: host.cancelAnimationFrame?.bind(host),
    requestIdleCallback: host.requestIdleCallback?.bind(host),
    cancelIdleCallback: host.cancelIdleCallback?.bind(host),
    performance: host.performance,
    Intl: host.Intl,
    Date: host.Date,
    AbortSignal: host.AbortSignal,
  };
}

function initializeAdapterBridge(
  sabotagedMethod: string | null,
  sabotagedMatcher: string | null
) {
  const host = window as any;
  host.__pwLiteEvidence = {
    entered: [],
    expect: [],
    expectPaths: [],
    failures: [],
  };
  host.__pwLiteSabotagedMatcher = sabotagedMatcher;
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
  // An error thrown out of an adapter member — including one a page function
  // the adapter ran threw — is the adapter's, not the bridge's: only that
  // boundary knows, since a bridge dispatch error can carry the same message.
  // A member's rejection is marked on a derived promise that rethrows the
  // same error, and the caller receives that promise: one it leaves unawaited
  // still rejects unhandled, exactly as the adapter's own would. A thrown
  // primitive cannot be marked, so it stays classified by its message alone.
  const adapterErrors = new WeakSet<object>();
  const markAdapterError = (error: unknown) => {
    if (typeof error === "object" && error !== null) adapterErrors.add(error);
  };
  const callAdapter = (call: () => any) => {
    let result: any;
    try {
      result = call();
    } catch (error) {
      markAdapterError(error);
      throw error;
    }
    return result instanceof Promise
      ? result.then(undefined, (error) => {
          markAdapterError(error);
          throw error;
        })
      : result;
  };
  // Playwright rejects the Node side of an evaluation with the browser's
  // description of the thrown error, which starts with its stack's first line.
  // An adapter error leaving the bridge is recorded under that line until the
  // Node side claims the rejection it caused, so a matching claim can only
  // name an error the adapter raised.
  const unclaimedAdapterErrors: string[] = [];
  host.__pwLiteClaimAdapterError = (line: string) => {
    const index = unclaimedAdapterErrors.indexOf(line);
    if (index === -1) return false;
    unclaimedAdapterErrors.splice(index, 1);
    return true;
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
      if (
        adapterErrors.has(error as object) &&
        typeof (error as Error).stack === "string"
      )
        unclaimedAdapterErrors.push((error as Error).stack!.split("\n")[0]);
      throw error;
    }
  };
  const typedArrayConstructors: Record<string, any> = {
    i8: Int8Array,
    ui8: Uint8Array,
    ui8c: Uint8ClampedArray,
    i16: Int16Array,
    ui16: Uint16Array,
    i32: Int32Array,
    ui32: Uint32Array,
    f32: Float32Array,
    f64: Float64Array,
    bi64: BigInt64Array,
    bui64: BigUint64Array,
  };
  // Mirrors pinned server/javascript.ts normalizeExpression: a method
  // shorthand (`foo() {}`) only becomes an expression once it is prefixed.
  // Rebuilding the caller's function keeps its source, which the adapter
  // stringifies again for its own serialization and error messages. The
  // callback has no Node closure, but the name `expect` resolves to the
  // adapter's public expect, so a handler can assert on its generic matchers.
  host.__pwLiteReconstructFunction = function reconstruct(source: string) {
    let result = source.trim();
    try {
      new Function("(" + result + ")");
    } catch {
      result = result.startsWith("async ")
        ? "async function " + result.substring("async ".length)
        : "function " + result;
    }
    return (0, eval)("(function (expect) { return (" + result + "); })")(
      host.__pwLiteAdapter.expect
    );
  };
  host.__pwLiteDecodeBridgeValue = function decode(value: any): any {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(decode);
    if (typeof value.__pwLiteFunctionSource === "string")
      return host.__pwLiteReconstructFunction(value.__pwLiteFunctionSource);
    if (value.__pwLiteTypedArray) {
      const { k, b } = value.__pwLiteTypedArray;
      return new typedArrayConstructors[k](Uint8Array.from(b).buffer);
    }
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
    // Walk the whole prototype chain, up to but not including
    // Object.prototype, so a member inherited from a base class (e.g.
    // AdapterElementHandle inheriting AdapterJSHandle.jsonValue) is recorded
    // under the subclass's kind instead of being skipped because it is not
    // an own member of the immediate prototype.
    const names = new Set<string>();
    for (
      let prototype = Object.getPrototypeOf(object);
      prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (
          name === "constructor" ||
          (members && !members.includes(name)) ||
          typeof Object.getOwnPropertyDescriptor(prototype, name)?.value !==
            "function"
        )
          continue;
        names.add(name);
      }
    }
    for (const name of names) {
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
        if (
          (recordedName === "Locator._expect" ||
            recordedName === "Page._expect") &&
          host.__pwLiteActiveExpectMatcher
        )
          host.__pwLiteEvidence.expectPaths.push({
            matcher: host.__pwLiteActiveExpectMatcher,
            method: recordedName,
          });
        // Every adapter call the evidence records routes through here, so this
        // is the one place a promotion rerun can withhold a method from the
        // test that claims to prove it.
        if (recordedName === sabotagedMethod)
          throw new Error(
            `__pwLiteSabotagedMethod: ${recordedName} was withheld for promotion review.`
          );
        const result = callAdapter(() => original.apply(this, args));
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
  // A handle is stored under the kind Playwright's own API gives it, told by
  // what `asElement()` answers: a handle that answers with itself is an
  // ElementHandle and any other is a JSHandle, whatever the returning member
  // declares (`evaluateHandle`, `waitForFunction` and `getProperty` answer an
  // ElementHandle for an element value). The answer is read only before the
  // handle is instrumented, so it is not execution evidence; a handle stored
  // again keeps the kind it was first instrumented under. Only a Disposable,
  // which is not a handle, names its own kind.
  host.__pwLiteStoreElementHandle = function store(
    handle: any,
    kind?: "Disposable"
  ): string | null {
    if (!handle) return null;
    const id = `${handleContext}:element-${++nextElementHandleId}`;
    if (wrapped.has(handle)) {
      host.__pwLiteElementHandles.set(id, handle);
      return id;
    }
    const element =
      typeof handle.asElement === "function" && handle.asElement() === handle;
    host.__pwLiteElementHandles.set(
      id,
      instrument(handle, kind ?? (element ? "ElementHandle" : "JSHandle"))
    );
    return id;
  };
  // A member the bridge has no dedicated route for still returns the adapter's
  // own handles, which cannot cross the evaluation boundary by value. Store
  // each one and report a reference the Node side republishes as a proxy.
  // A handle is recognized by the surface the adapter's ElementHandle and
  // JSHandle share — `dispose` together with `asElement` or `jsonValue` — and
  // stored under its kind like a dedicated route's handle. A Disposable
  // (Locator.highlight, Page.exposeFunction, Page.exposeBinding) has
  // `dispose` alone, so it stays with its own route.
  // A Request or Response the adapter reported. Playwright answers most of
  // their members synchronously, which no evaluation round trip can do, so
  // those members are read here, when the object crosses the boundary, and
  // replayed on the Node side. Reading them is bookkeeping, not a call the
  // test made, so it stays out of the execution evidence.
  const networkSyncMembers: Record<string, readonly string[]> = {
    Request: [
      "url",
      "resourceType",
      "method",
      "headers",
      "postData",
      "postDataBuffer",
      "postDataJSON",
      "isNavigationRequest",
      "failure",
    ],
    Response: ["url", "status", "statusText", "ok", "headers"],
  };
  host.__pwLiteNetworkObjects = new Map<string, any>();
  const encodeNetworkValue = (value: any) =>
    value instanceof Uint8Array
      ? { __pwLiteNetworkBytes: Array.from(value) }
      : value;
  const isNetworkObject = (value: any) =>
    !!value &&
    typeof value === "object" &&
    typeof value.url === "function" &&
    (typeof value.resourceType === "function" ||
      typeof value.status === "function");
  // A `ConsoleMessage`, told apart from a Request/Response (no `url`) by its
  // own member set, the same minimal way `isNetworkObject` distinguishes a
  // Request/Response from anything else.
  const isConsoleMessageObject = (value: any) =>
    !!value &&
    typeof value === "object" &&
    typeof value.text === "function" &&
    typeof value.type === "function";
  // Every pinned member is synchronous, so the message is fully snapshotted
  // here, when it crosses the boundary, the way a Request/Response's
  // synchronous members are. `page()`/`worker()` are read from the message
  // itself, not assumed: `page` records only whether it was this test's own
  // adapter page, since a live Page cannot itself cross the boundary.
  // `args()` still needs a round trip on the Node side to turn each held
  // handle into a proxy, so it travels as the same handle-reference
  // envelopes `encode` gives any other adapter handle.
  host.__pwLiteStoreConsoleMessage = function store(value: any): any {
    return {
      __pwLiteConsoleMessageRef: true,
      type: value.type(),
      text: value.text(),
      timestamp: value.timestamp(),
      location: value.location(),
      page: value.page() === host.__pwLiteAdapterPage,
      worker: value.worker(),
      args: host.__pwLiteEncodeAdapterResult(value.args()),
    };
  };
  host.__pwLiteStoreNetworkObject = function store(value: any): any {
    const kind =
      typeof value.resourceType === "function" ? "Request" : "Response";
    const id = `${handleContext}:network-${++nextElementHandleId}`;
    host.__pwLiteNetworkObjects.set(id, value);
    const snapshot: Record<string, any> = {};
    for (const member of networkSyncMembers[kind]) {
      try {
        snapshot[member] = { value: encodeNetworkValue(value[member]()) };
      } catch (error) {
        snapshot[member] = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      __pwLiteNetworkRef: id,
      kind,
      snapshot,
      request: kind === "Response" ? store(value.request()) : undefined,
    };
  };
  host.__pwLiteNetworkCall = function call(
    id: string,
    kind: string,
    member: string,
    args: any[]
  ) {
    const target = host.__pwLiteNetworkObjects.get(id);
    if (!target) throw new Error(`Unknown adapter ${kind}: ${id}`);
    const recorded = `${kind}.${member}`;
    host.__pwLiteEvidence.entered.push(recorded);
    if (recorded === sabotagedMethod)
      throw new Error(
        `__pwLiteSabotagedMethod: ${recorded} was withheld for promotion review.`
      );
    if (typeof target[member] !== "function")
      throw new TypeError(`__pwLiteAdapter${kind}.${member} is not a function`);
    const decoded = host.__pwLiteDecodeBridgeValue(args);
    return callAdapter(() => target[member](...decoded));
  };
  host.__pwLiteEncodeAdapterResult = function encode(value: any): any {
    if (Array.isArray(value)) return value.map(encode);
    if (isNetworkObject(value)) return host.__pwLiteStoreNetworkObject(value);
    if (isConsoleMessageObject(value))
      return host.__pwLiteStoreConsoleMessage(value);
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.dispose !== "function" ||
      (typeof value.asElement !== "function" &&
        typeof value.jsonValue !== "function")
    )
      return value;
    return { __pwLiteElementHandleRef: host.__pwLiteStoreElementHandle(value) };
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
