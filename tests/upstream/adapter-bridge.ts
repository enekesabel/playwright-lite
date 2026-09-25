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
const NATIVE_RESULT_MARKER = "__pwLiteNativeResult";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

let nextAbortSignalId = 0;
type ChainStep = [string, unknown[]];
type AdapterPageState = {
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
  // Playwright Test's resolved `expect.timeout`, applied through the adapter
  // expect's public `configure` so an unconfigured assertion waits as long as
  // Playwright Test's own would.
  expectTimeout?: number;
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

  if (Array.isArray(value)) {
    const encoded: unknown[] = [];
    seen.set(value, encoded);
    for (const item of value)
      encoded.push(encodeBridgeValue(item, seen, ownerPage));
    return encoded;
  }

  // The transport codec carries these with their kind intact, as the pinned
  // serializers do for a client-side evaluate argument, so they travel
  // unchanged. A typed array keeps its view (a Buffer subarray arrives as
  // those bytes); the runtime owns what the bytes mean, such as a file.
  if (
    value instanceof RegExp ||
    value instanceof Date ||
    value instanceof URL ||
    value instanceof Error ||
    (ArrayBuffer.isView(value) && !(value instanceof DataView))
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

// Every envelope carries the adapter's `url()` as it answered when the
// operation settled; see `observedUrls`.
type BridgeEnvelope<Result> = { url: string } & (
  | { kind: "value"; value: Result }
  | { kind: "adapter-timeout"; message: string }
  | {
      kind: "adapter-error";
      name: string;
      message: string;
      causeMatchedAbortReason?: boolean;
    }
);

/**
 * Adapter errors whose browser-side `cause` was the abort reason the adapter
 * was given. Only those may have the reason's object identity restored on the
 * Node side, because identity cannot survive the evaluation boundary.
 */
const abortErrorsCarryingTheirReason = new WeakSet<Error>();

const testIdAttributeSynchronizers = new WeakMap<Page, () => Promise<void>>();

/**
 * Per page, evaluates a page function that enters the adapter under a token
 * of its own, so an adapter error can be claimed only by the evaluation it
 * left.
 */
const adapterEvaluations = new WeakMap<
  Page,
  (pageFunction: unknown, arg: unknown) => Promise<unknown>
>();
let lastEvaluationToken = 0;

/**
 * Per page, the adapter's own `url()` answer from the latest round trip into
 * the adapter. `Page.url()` is synchronous and cannot ask the browser, so it
 * replays this answer. Every envelope `__pwLiteInvokeAdapter` returns carries
 * it, so any adapter call the test awaited leaves it current; after a native
 * member settles the bridge asks again, since a native call can change the
 * URL too (the script a native `setContent` writes can push history state).
 */
const observedUrls = new WeakMap<Page, string>();

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
  const evaluateInScope = adapterEvaluations.get(realPage)!;
  const envelope = (await evaluateInScope(
    pageFunction,
    arg
  )) as BridgeEnvelope<Result>;
  observedUrls.set(realPage, envelope.url);
  return unwrapBridgeEnvelope(envelope);
}

/** A round trip that only brings back the adapter's current `url()`. */
async function refreshObservedUrl(realPage: Page): Promise<void> {
  await evaluateAdapter<void>(
    realPage,
    () => (window as any).__pwLiteInvokeAdapter(() => undefined),
    undefined
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ── Transport ───────────────────────────────────────────────────────

type TransportCodec = {
  encode(value: unknown): string;
  decode(payload: string): unknown;
};

/**
 * The wire format of every bridge payload that crosses `realPage.evaluate`.
 *
 * Playwright's utility script parses an evaluate argument and serializes its
 * result in the page with methods it looks up on the page's own prototypes
 * (`result.push`, `o.push`), so a page that replaces `Array.prototype.push`
 * breaks every array argument and turns every object result into
 * `undefined`. A string is the one payload that script passes through
 * without calling anything, so each bridge payload crosses as one string
 * this codec writes on one side and reads on the other.
 *
 * The format and its value rules are the pinned utility script's
 * (`packages/isomorphic/utilityScriptSerializers.ts`), which is what the
 * payload met on its way through Playwright before: `Date`, `URL`, `RegExp`,
 * `Error`, `BigInt`, typed arrays, `ArrayBuffer` and the special numbers keep
 * their kind, a repeated or circular reference stays one object, and any
 * other object travels as its own enumerable properties. Node's side refuses
 * what Playwright's client refuses (`packages/protocol/src/serializers.ts`
 * and its validator): a function and an invalid `Date`. The page's side drops
 * a function the way the utility script does.
 *
 * The tags are the pinned ones: `v` a special value, `d` Date, `u` URL, `bi`
 * BigInt, `e` Error (`n`ame, `m`essage, `s`tack), `r` RegExp (`p`attern,
 * `f`lags), `ta` typed array (`b`ase64, `k`ind), `ab` ArrayBuffer, `a` array
 * and `o` object (`k`ey/`v`alue entries), each with an `id` that `ref` names.
 *
 * Like the pinned UtilityScript, which takes its builtins when it is
 * constructed, the codec takes every builtin it calls when it is created (in
 * the page, when the bridge is installed, before any page script runs) and
 * never looks one up on a prototype the page can replace. The only page code
 * it runs is what the pinned serializer runs as well: an own-keyless object's
 * `toJSON`. Its own arrays and records have no prototype, so a page's
 * `toJSON` cannot rewrite them in `JSON.stringify`. Node and every document
 * build it from this same source, so it closes over nothing.
 */
function createTransportCodec(side: "node" | "page"): TransportCodec {
  const host = globalThis as any;
  const pageSide = side === "page";
  const apply = Reflect.apply;
  const {
    create,
    getOwnPropertyDescriptor,
    getPrototypeOf,
    is,
    keys,
    setPrototypeOf,
  } = Object;
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const objectToString = Object.prototype.toString;
  const isFiniteNumber = Number.isFinite;
  const isArray = Array.isArray;
  const { parse, stringify } = JSON;
  const VisitedMap = Map;
  const visitedGet = Map.prototype.get;
  const visitedSet = Map.prototype.set;
  const DateConstructor = Date;
  const dateValue = Date.prototype.valueOf;
  const dateToISOString = Date.prototype.toISOString;
  const URLConstructor = URL;
  const urlToJSON = URL.prototype.toJSON;
  const RegExpConstructor = RegExp;
  const regExpSource = getOwnPropertyDescriptor(
    RegExp.prototype,
    "source"
  )!.get!;
  const regExpFlags = getOwnPropertyDescriptor(RegExp.prototype, "flags")!.get!;
  const ErrorConstructor = Error;
  const BigIntConstructor = BigInt;
  const bigIntToString = BigInt.prototype.toString;
  const startsWith = String.prototype.startsWith;
  const charCodeAt = String.prototype.charCodeAt;
  const fromCharCode = String.fromCharCode;
  const toBase64 = host.btoa.bind(host) as (text: string) => string;
  const fromBase64 = host.atob.bind(host) as (text: string) => string;
  const Bytes = Uint8Array;
  // Present in current Chromium; the pinned serializer prefers it too.
  const nativeToBase64 = (Uint8Array.prototype as any).toBase64;
  const ArrayBufferConstructor = ArrayBuffer;
  const typedArrayPrototype = getPrototypeOf(Int8Array.prototype);
  const viewBuffer = getOwnPropertyDescriptor(
    typedArrayPrototype,
    "buffer"
  )!.get!;
  const viewByteOffset = getOwnPropertyDescriptor(
    typedArrayPrototype,
    "byteOffset"
  )!.get!;
  const viewByteLength = getOwnPropertyDescriptor(
    typedArrayPrototype,
    "byteLength"
  )!.get!;
  const WindowConstructor = host.Window;
  const DocumentConstructor = host.Document;
  const NodeConstructor = host.Node;
  const typedArrayKinds: [string, any, string][] = [
    ["i8", Int8Array, "[object Int8Array]"],
    ["ui8", Uint8Array, "[object Uint8Array]"],
    ["ui8c", Uint8ClampedArray, "[object Uint8ClampedArray]"],
    ["i16", Int16Array, "[object Int16Array]"],
    ["ui16", Uint16Array, "[object Uint16Array]"],
    ["i32", Int32Array, "[object Int32Array]"],
    ["ui32", Uint32Array, "[object Uint32Array]"],
    ["f32", Float32Array, "[object Float32Array]"],
    ["f64", Float64Array, "[object Float64Array]"],
    ["bi64", BigInt64Array, "[object BigInt64Array]"],
    ["bui64", BigUint64Array, "[object BigUint64Array]"],
  ];

  const list = (): any[] => setPrototypeOf([], null);
  const tagged = (key: string, value: unknown): any => {
    const result = create(null);
    result[key] = value;
    return result;
  };
  // What upstream sends for a function-valued own `toJSON`: an empty object.
  const emptyObject = () => {
    const result = tagged("o", list());
    result.id = 0;
    return result;
  };
  const owns = (value: object, key: string) =>
    apply(hasOwnProperty, value, [key]);
  const isKind = (value: any, constructor: any, tag: string) => {
    try {
      return (
        value instanceof constructor || apply(objectToString, value, []) === tag
      );
    } catch {
      return false;
    }
  };
  const isError = (value: any) => {
    try {
      return (
        value instanceof ErrorConstructor ||
        (!!value && getPrototypeOf(value)?.name === "Error")
      );
    } catch {
      return false;
    }
  };
  const bytesToBase64 = (bytes: Uint8Array) => {
    if (typeof nativeToBase64 === "function")
      return apply(nativeToBase64, bytes, []) as string;
    const length = apply(viewByteLength, bytes, []);
    let binary = "";
    for (let i = 0; i < length; i++) binary += fromCharCode(bytes[i]!);
    return toBase64(binary);
  };
  const base64ToBytes = (base64: string) => {
    const binary = fromBase64(base64);
    const bytes = new Bytes(binary.length);
    for (let i = 0; i < binary.length; i++)
      bytes[i] = apply(charCodeAt, binary, [i]);
    return bytes;
  };

  type Visitor = { visited: Map<object, number>; lastId: number };

  function serialize(value: any, visitor: Visitor): any {
    if (pageSide && value && typeof value === "object") {
      if (
        typeof WindowConstructor === "function" &&
        value instanceof WindowConstructor
      )
        return "ref: <Window>";
      if (
        typeof DocumentConstructor === "function" &&
        value instanceof DocumentConstructor
      )
        return "ref: <Document>";
      if (
        typeof NodeConstructor === "function" &&
        value instanceof NodeConstructor
      )
        return "ref: <Node>";
    }
    return serializeValue(value, visitor);
  }

  function serializeValue(value: any, visitor: Visitor): any {
    if (typeof value === "symbol") return tagged("v", "undefined");
    if (is(value, undefined)) return tagged("v", "undefined");
    if (is(value, null)) return tagged("v", "null");
    if (is(value, NaN)) return tagged("v", "NaN");
    if (is(value, Infinity)) return tagged("v", "Infinity");
    if (is(value, -Infinity)) return tagged("v", "-Infinity");
    if (is(value, -0)) return tagged("v", "-0");
    if (
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    )
      return value;
    if (typeof value === "bigint")
      return tagged("bi", apply(bigIntToString, value, []));
    if (typeof value === "function") {
      if (pageSide) return undefined;
      throw new TypeError(
        `Attempting to serialize unexpected value: ${String(value)}`
      );
    }

    if (isError(value)) {
      const { name, message, stack } = value;
      const error = create(null);
      error.n = name;
      error.m = message;
      error.s =
        typeof stack === "string" &&
        apply(startsWith, stack, [`${name}: ${message}`])
          ? stack
          : `${name}: ${message}\n${stack}`;
      return tagged("e", error);
    }
    if (isKind(value, DateConstructor, "[object Date]")) {
      const time = apply(dateValue, value, []);
      if (isFiniteNumber(time))
        return tagged("d", apply(dateToISOString, value, []));
      // The protocol validator requires the ISO string an invalid Date lacks.
      if (!pageSide)
        throw new TypeError(
          "Attempting to serialize an invalid Date: expected string, got object"
        );
      return tagged("d", null);
    }
    if (isKind(value, URLConstructor, "[object URL]"))
      return tagged("u", apply(urlToJSON, value, []));
    if (isKind(value, RegExpConstructor, "[object RegExp]")) {
      const regExp = create(null);
      regExp.p = apply(regExpSource, value, []);
      regExp.f = apply(regExpFlags, value, []);
      return tagged("r", regExp);
    }
    for (let i = 0; i < typedArrayKinds.length; i++) {
      const kind = typedArrayKinds[i]!;
      if (isKind(value, kind[1], kind[2])) {
        const typedArray = create(null);
        typedArray.b = bytesToBase64(
          new Bytes(
            apply(viewBuffer, value, []),
            apply(viewByteOffset, value, []),
            apply(viewByteLength, value, [])
          )
        );
        typedArray.k = kind[0];
        return tagged("ta", typedArray);
      }
    }
    if (isKind(value, ArrayBufferConstructor, "[object ArrayBuffer]")) {
      const arrayBuffer = create(null);
      arrayBuffer.b = bytesToBase64(new Bytes(value));
      return tagged("ab", arrayBuffer);
    }

    const id = apply(visitedGet, visitor.visited, [value]);
    if (id) return tagged("ref", id);

    if (isArray(value)) {
      const items = list();
      const result = tagged("a", items);
      result.id = ++visitor.lastId;
      apply(visitedSet, visitor.visited, [value, result.id]);
      for (let i = 0; i < value.length; i++)
        items[i] = serialize(value[i], visitor);
      return result;
    }

    const entries = list();
    const result = tagged("o", entries);
    result.id = ++visitor.lastId;
    apply(visitedSet, visitor.visited, [value, result.id]);
    const names = keys(value);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      let item;
      try {
        item = value[name];
      } catch {
        continue; // native bindings will throw sometimes
      }
      const entry = create(null);
      entry.k = name;
      entry.v =
        pageSide && name === "toJSON" && typeof item === "function"
          ? emptyObject()
          : serialize(item, visitor);
      entries[entries.length] = entry;
    }
    if (pageSide && entries.length === 0) {
      let replacement;
      try {
        // An object with no own keys falls back to its toJSON, as upstream.
        if (value.toJSON && typeof value.toJSON === "function")
          replacement = { value: value.toJSON() };
      } catch {}
      if (replacement) return serializeValue(replacement.value, visitor);
    }
    return result;
  }

  function parseValue(value: any, refs: Record<number, object>): any {
    if (is(value, undefined)) return undefined;
    if (typeof value !== "object" || !value) return value;
    if (owns(value, "ref")) return refs[value.ref];
    if (owns(value, "v")) {
      if (value.v === "null") return null;
      if (value.v === "NaN") return NaN;
      if (value.v === "Infinity") return Infinity;
      if (value.v === "-Infinity") return -Infinity;
      if (value.v === "-0") return -0;
      return undefined;
    }
    if (owns(value, "d")) return new DateConstructor(value.d);
    if (owns(value, "u")) return new URLConstructor(value.u);
    if (owns(value, "bi")) return BigIntConstructor(value.bi);
    if (owns(value, "e")) {
      const error = new ErrorConstructor(value.e.m);
      error.name = value.e.n;
      error.stack = value.e.s;
      return error;
    }
    if (owns(value, "r")) return new RegExpConstructor(value.r.p, value.r.f);
    if (owns(value, "a")) {
      const result: any[] = [];
      refs[value.id] = result;
      for (let i = 0; i < value.a.length; i++)
        result[i] = parseValue(value.a[i], refs);
      return result;
    }
    if (owns(value, "o")) {
      const result: any = {};
      refs[value.id] = result;
      for (let i = 0; i < value.o.length; i++) {
        const { k, v } = value.o[i];
        if (k === "__proto__") continue;
        result[k] = parseValue(v, refs);
      }
      return result;
    }
    if (owns(value, "ta")) {
      for (let i = 0; i < typedArrayKinds.length; i++) {
        const kind = typedArrayKinds[i]!;
        if (kind[0] === value.ta.k)
          return new kind[1](apply(viewBuffer, base64ToBytes(value.ta.b), []));
      }
    }
    if (owns(value, "ab"))
      return apply(viewBuffer, base64ToBytes(value.ab.b), []);
    return value;
  }

  return {
    encode: (value) => {
      const serialized = serialize(value, {
        visited: new VisitedMap(),
        lastId: 0,
      });
      // A dropped top-level function arrives as undefined, as upstream.
      return stringify(
        serialized === undefined ? tagged("v", "undefined") : serialized
      );
    },
    decode: (payload) => {
      if (typeof payload !== "string")
        throw new TypeError(
          `Cannot deserialize a bridge transport payload of type ${typeof payload}`
        );
      return parseValue(parse(payload), create(null));
    },
  };
}

const nodeTransport = createTransportCodec("node");

/**
 * Runs `pageFunctionSource` in the page on the transport: its argument and
 * its result each cross `realPage.evaluate` as one codec string. The page
 * function is composed here rather than rebuilt in the page, whose CSP may
 * refuse eval, so it still reaches the page as Playwright sends any.
 */
async function evaluateInTransport(
  evaluate: (pageFunction: never, arg: string) => Promise<unknown>,
  pageFunctionSource: string,
  arg: unknown
): Promise<unknown> {
  const inTransport = new Function(
    "payload",
    `return window.__pwLiteTransport(payload, ${pageFunctionSource});`
  );
  return nodeTransport.decode(
    (await evaluate(inTransport as never, nodeTransport.encode(arg))) as string
  );
}

/**
 * Runs `pageFunctionSource` with `arg` on the transport through `realPage`'s
 * own evaluate. Page code has no access to it, so it serves the fixture's
 * bookkeeping and the guards that prove the codec.
 */
export function evaluateInPageTransport(
  realPage: Page,
  pageFunctionSource: string,
  arg?: unknown
): Promise<unknown> {
  return evaluateInTransport(
    (pageFunction, payload) => realPage.evaluate(pageFunction, payload),
    pageFunctionSource,
    arg
  );
}

/** The execution evidence the bridge recorded in the page's document. */
export function readAdapterEvidence(realPage: Page): Promise<unknown> {
  return evaluateInPageTransport(realPage, "() => window.__pwLiteEvidence");
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
    `\n(${initializeAdapterBridge.toString()})(${JSON.stringify({
      sabotagedMethod: timeoutDefaults.sabotagedMethod ?? null,
      sabotagedMatcher: timeoutDefaults.sabotagedMatcher ?? null,
      expectTimeout: timeoutDefaults.expectTimeout ?? null,
    } satisfies BridgeSettings)}, (${createTransportCodec.toString()})("page"));`;

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
  // so the browser side, which saw where it was thrown, decides. It answers
  // for one evaluation only: two errors can share their text, never a token.
  const raisedByAdapter = (token: number) =>
    evaluate(
      (t) => (window as any).__pwLiteClaimAdapterError?.(t) === true,
      token
    ).catch(() => false);
  const recordTransportFailures = async (
    evaluation: () => Promise<unknown>,
    token?: number
  ) => {
    try {
      return await evaluation();
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
        if (token !== undefined && (await raisedByAdapter(token))) {
          const index = failures.lastIndexOf(firstLine);
          if (index !== -1) failures.splice(index, 1);
        }
      }
      throw error;
    }
  };
  realPage.evaluate = ((...args: any[]) =>
    recordTransportFailures(() =>
      (evaluate as any)(...args)
    )) as Page["evaluate"];
  adapterEvaluations.set(realPage, (pageFunction, arg) => {
    const token = ++lastEvaluationToken;
    return recordTransportFailures(
      () =>
        evaluateInTransport(
          evaluate as never,
          `({ token, arg }) => window.__pwLiteInEvaluation(token, ${String(pageFunction)}, arg)`,
          { token, arg }
        ),
      token
    );
  });
  await refreshObservedUrl(realPage);
  return createPageProxy(realPage, {
    nativeNavigationForSetup: timeoutDefaults.nativeNavigationForSetup,
  });
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
        const value = await evaluateAdapter<unknown>(
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
              return host.__pwLiteEncodeAdapterResult(value);
            }, a);
          },
          { member, args: encodedArgs as any[] }
        );
        return decodeBridgeResult(value, realPage, state);
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

      // Page.url() is synchronous in Playwright's public API, so it replays
      // the adapter's own answer from the latest round trip.
      if (prop === "url") return () => observedUrls.get(realPage);

      // Keyboard is a synchronous Page property whose methods must execute in
      // the browser adapter. Do not leak the native Playwright keyboard.
      if (prop === "keyboard") return createKeyboardProxy(realPage);
      // Touchscreen is the same kind of property; its tap executes in the
      // browser adapter and never on the native Playwright touchscreen.
      if (prop === "touchscreen") return createTouchscreenProxy(realPage);
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
          const previous = (await readAdapterEvidence(realPage)) as {
            entered: string[];
          };
          // The bridge's own url() reads stay out of the evidence, so every
          // recorded member is one the test entered.
          if (previous.entered.length > 0)
            return adapterMember("goto")(...args);
          nativeOperationLog(realPage).push("Page.goto");
          const response = await realPage.goto(...args);
          await evaluateInPageTransport(
            realPage,
            "(prior) => window.__pwLiteRestoreEvidence(prior)",
            previous
          );
          await refreshObservedUrl(realPage);
          return wrapNativeResult(response, realPage);
        };
      }

      // Only ledger-declared out-of-scope Page members may use the native
      // driver. Record them, and wrap any object they return so downstream
      // native operations cannot be mistaken for browser adapter evidence.
      // The document's URL can change while one runs, so once an
      // asynchronous one settles the bridge asks the adapter's url() again.
      if (isOutOfScope("Page", prop)) {
        return (...args: unknown[]) => {
          nativeOperationLog(realPage).push(`Page.${prop}`);
          const nativeMember = Reflect.get(target, prop, receiver);
          if (typeof nativeMember !== "function")
            throw new TypeError(`Native Page.${prop} is not a function`);
          const result = nativeMember.apply(target, args);
          // The same thenable test `wrapNativeResult` applies.
          return wrapNativeResult(
            typeof (result as Promise<unknown> | undefined)?.then === "function"
              ? (result as Promise<unknown>).then(async (value) => {
                  await refreshObservedUrl(realPage);
                  return value;
                })
              : result,
            realPage
          );
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
                host.__pwLiteEach(
                  await host.__pwLiteAdapterPage.$$(s),
                  (handle: any) => host.__pwLiteStoreElementHandle(handle)
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

      // The caller's arguments travel as they were given, the function among
      // them rebuilt from its source, so the adapter applies its own argument
      // rules, including the `exposeFunctions` option and the argument count.
      // These stay off the generic member route: that route walks arrays in
      // a result to find handles, and a by-value result can be a cyclic array.
      if (prop === "evaluate") {
        return async (...args: unknown[]) =>
          evaluateAdapter(
            realPage,
            ({ args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() =>
                host.__pwLiteAdapterPage.evaluate(
                  ...host.__pwLiteDecodeBridgeValue(a)
                )
              );
            },
            { args: encodeBridgeValueForPage(args, realPage) as unknown[] }
          );
      }

      if (prop === "evaluateHandle") {
        return async (...args: unknown[]) => {
          const id = await evaluateAdapter<string>(
            realPage,
            ({ args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(async () =>
                host.__pwLiteStoreElementHandle(
                  await host.__pwLiteAdapterPage.evaluateHandle(
                    ...host.__pwLiteDecodeBridgeValue(a)
                  )
                )
              );
            },
            { args: encodeBridgeValueForPage(args, realPage) as unknown[] }
          );
          return createElementHandleProxy(realPage, state, id);
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
                  isFunction
                    ? host.__pwLiteReconstructFunction(expression)
                    : expression,
                  host.__pwLiteDecodeBridgeValue(a),
                  host.__pwLiteDecodeBridgeValue(opts)
                );
                return host.__pwLiteStoreElementHandle(handle);
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
            host.__pwLiteAppend(host.__pwLiteEvidence.expect, recordedName);
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
              ? host.__pwLiteExpect.configure(configuration)
              : host.__pwLiteExpect;
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

function createTouchscreenProxy(realPage: Page): Page["touchscreen"] {
  return {
    tap: (x: number, y: number) =>
      evaluateAdapter<void>(
        realPage,
        ({ args: rawArgs }) => {
          const host = window as any;
          return host.__pwLiteInvokeAdapter(() => {
            const touchscreen = host.__pwLiteAdapterPage.touchscreen;
            // A missing member is reported as such, like a Page member the
            // adapter does not have.
            if (typeof touchscreen?.tap !== "function")
              throw new TypeError(
                "__pwLiteAdapterPage.touchscreen.tap is not a function"
              );
            return touchscreen.tap(...host.__pwLiteDecodeBridgeValue(rawArgs));
          });
        },
        { args: encodeBridgeValueForPage([x, y], realPage) as unknown[] }
      ),
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
                host.__pwLiteEach(
                  await host.__pwLiteElementHandleForId(handleId).$$(s),
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

      // Every other member, `evaluate` among them, receives the caller's
      // arguments as they were given, so the adapter applies its own rules.
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
                  return host.__pwLiteEach(
                    await current.all(),
                    (locator: any) => host.__pwLiteStoreLocator(locator)
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
                return host.__pwLiteEach(
                  await current.elementHandles(),
                  (handle: any) => host.__pwLiteStoreElementHandle(handle)
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

type BridgeSettings = {
  sabotagedMethod: string | null;
  sabotagedMatcher: string | null;
  expectTimeout: number | null;
};

function initializeAdapterBridge(
  { sabotagedMethod, sabotagedMatcher, expectTimeout }: BridgeSettings,
  transport: TransportCodec
) {
  const host = window as any;
  // This runs before any page script, so these are the document's own
  // builtins. The bridge's bookkeeping calls them instead of the methods a
  // page can replace on Array.prototype, Object and Function.prototype, as
  // the transport codec does for the payloads themselves.
  const apply = Reflect.apply;
  const isArray = Array.isArray;
  const { defineProperty, getPrototypeOf, keys } = Object;
  const objectPrototype = Object.prototype;
  const trim = String.prototype.trim;
  const startsWith = String.prototype.startsWith;
  const slice = String.prototype.slice;
  const append = (list: unknown[], value: unknown) => {
    list[list.length] = value;
  };
  const each = (list: any, map: (item: any) => unknown) => {
    const result: unknown[] = [];
    for (let i = 0; i < list.length; i++) result[i] = map(list[i]);
    return result;
  };
  host.__pwLiteAppend = append;
  host.__pwLiteEach = each;
  // Every bridge payload crosses realPage.evaluate as one transport string.
  // `run` is entered before the first await, so an evaluation token it sets
  // is still in scope when its page function enters the bridge.
  host.__pwLiteTransport = async (
    payload: string,
    run: (arg: unknown) => unknown
  ) => transport.encode(await run(transport.decode(payload)));
  // An unconfigured assertion waits as long as Playwright Test's own would.
  host.__pwLiteExpect =
    typeof expectTimeout === "number"
      ? host.__pwLiteAdapter.expect.configure({ timeout: expectTimeout })
      : host.__pwLiteAdapter.expect;
  host.__pwLiteEvidence = {
    entered: [],
    expect: [],
    expectPaths: [],
    failures: [],
    // Only a promotion rerun withholds a method, so only its evidence records
    // each dispatch of that method that was withheld; an ordinary run has no
    // `withheld` at all.
    ...(sabotagedMethod ? { withheld: [] } : {}),
  };
  // A native setup navigation replaced the document: what the previous one
  // recorded comes first.
  const lists = sabotagedMethod
    ? ["entered", "expect", "expectPaths", "failures", "withheld"]
    : ["entered", "expect", "expectPaths", "failures"];
  host.__pwLiteRestoreEvidence = (prior: any) => {
    for (let i = 0; i < lists.length; i++) {
      const current = host.__pwLiteEvidence[lists[i]!];
      const earlier = prior[lists[i]!] ?? [];
      for (let j = current.length - 1; j >= 0; j--)
        current[j + earlier.length] = current[j];
      for (let j = 0; j < earlier.length; j++) current[j] = earlier[j];
    }
  };
  // A promotion rerun withholds its sabotaged method from the test: the
  // dispatch is recorded and throws instead of executing.
  const withhold = (name: string) => {
    if (name !== sabotagedMethod) return;
    append(host.__pwLiteEvidence.withheld, name);
    throw new Error(
      `__pwLiteSabotagedMethod: ${name} was withheld for promotion review.`
    );
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
    const options = isArray(encodedArgs)
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
  // The Node side runs each page function that enters the adapter under a
  // token of its own evaluation. An adapter error leaving the bridge is
  // recorded under that token until the Node side claims the rejection it
  // caused, so a claim can only name an error the adapter raised in the
  // caller's own evaluation. Every such page function enters the bridge before
  // it first awaits, so the token in scope is still its own.
  let evaluationToken: number | undefined;
  host.__pwLiteInEvaluation = (
    token: number,
    pageFunction: (arg: unknown) => unknown,
    arg: unknown
  ) => {
    evaluationToken = token;
    try {
      return pageFunction(arg);
    } finally {
      evaluationToken = undefined;
    }
  };
  const unclaimedAdapterErrors = new Set<number>();
  host.__pwLiteClaimAdapterError = (token: number) =>
    unclaimedAdapterErrors.delete(token);
  // The adapter's own url(), read once each operation settled and replayed on
  // the Node side for the synchronous Page.url(). Reading it is bookkeeping,
  // not a call the test made, so the method is taken before `instrument`
  // wraps it and the read stays out of the execution evidence.
  const adapterPage = host.__pwLiteAdapterPage;
  const adapterUrl = adapterPage.url.bind(adapterPage) as () => string;
  // Every envelope, whatever its kind, is stamped with the url here, once.
  host.__pwLiteInvokeAdapter = async function invoke(
    operation: () => any,
    encodedArgs?: any
  ) {
    const token = evaluationToken;
    return {
      ...(await settle(operation, encodedArgs, token)),
      url: adapterUrl(),
    };
  };
  const settle = async function settle(
    operation: () => any,
    encodedArgs: any,
    token: number | undefined
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
      if (adapterErrors.has(error as object) && token !== undefined)
        unclaimedAdapterErrors.add(token);
      throw error;
    }
  };
  // Mirrors pinned server/javascript.ts normalizeExpression: a method
  // shorthand (`foo() {}`) only becomes an expression once it is prefixed.
  // Rebuilding the caller's function keeps its source, which the adapter
  // stringifies again for its own serialization and error messages. The
  // callback has no Node closure, but the name `expect` resolves to the
  // adapter's public expect (configured with the runner's expect timeout), so
  // a handler can assert on its generic matchers.
  host.__pwLiteReconstructFunction = function reconstruct(source: string) {
    let result = apply(trim, source, []);
    try {
      new Function("(" + result + ")");
    } catch {
      result = apply(startsWith, result, ["async "])
        ? "async function " + apply(slice, result, ["async ".length])
        : "function " + result;
    }
    return (0, eval)("(function (expect) { return (" + result + "); })")(
      host.__pwLiteExpect
    );
  };
  host.__pwLiteDecodeBridgeValue = function decode(value: any): any {
    if (!value || typeof value !== "object") return value;
    if (isArray(value)) return each(value, decode);
    if (typeof value.__pwLiteFunctionSource === "string")
      return host.__pwLiteReconstructFunction(value.__pwLiteFunctionSource);
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
    if (isArray(value.__pwLiteLocatorChain))
      return host.__pwLiteReplayAdapterChain(value.__pwLiteLocatorChain);
    if (getPrototypeOf(value) !== objectPrototype) return value;
    const decoded = {};
    const names = keys(value);
    for (let i = 0; i < names.length; i++)
      defineProperty(decoded, names[i]!, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: decode(value[names[i]!]),
      });
    return decoded;
  };
  host.__pwLiteReplayAdapterChain = function replay(chain: any[]): any {
    let current: any = host.__pwLiteAdapterPage;
    for (let i = 0; i < chain.length; i++) {
      const method = chain[i][0];
      const args = chain[i][1];
      current =
        method === "__pwLiteLocatorRef"
          ? host.__pwLiteLocators.get(args[0])
          : apply(
              current[method],
              current,
              host.__pwLiteDecodeBridgeValue(args)
            );
    }
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
        append(host.__pwLiteEvidence.entered, recordedName);
        if (
          (recordedName === "Locator._expect" ||
            recordedName === "Page._expect") &&
          host.__pwLiteActiveExpectMatcher
        )
          append(host.__pwLiteEvidence.expectPaths, {
            matcher: host.__pwLiteActiveExpectMatcher,
            method: recordedName,
          });
        // Every adapter call the evidence records routes through here, so this
        // is the one place a promotion rerun can withhold a method from the
        // test that claims to prove it.
        withhold(recordedName);
        const result = callAdapter(() => apply(original, this, args));
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
      ? { __pwLiteNetworkBytes: each(value, (byte) => byte) }
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
    append(host.__pwLiteEvidence.entered, recorded);
    withhold(recorded);
    if (typeof target[member] !== "function")
      throw new TypeError(`__pwLiteAdapter${kind}.${member} is not a function`);
    const decoded = host.__pwLiteDecodeBridgeValue(args);
    return callAdapter(() => apply(target[member], target, decoded));
  };
  host.__pwLiteEncodeAdapterResult = function encode(value: any): any {
    if (isArray(value)) return each(value, encode);
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
