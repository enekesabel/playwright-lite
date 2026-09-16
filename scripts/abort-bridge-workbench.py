from pathlib import Path

path = Path("tests/upstream/adapter-bridge.ts")
text = path.read_text()

def replace(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)

replace(
'''const ELEMENT_HANDLE_REF_PAYLOAD = "__pwLiteElementHandleRef";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";''',
'''const ELEMENT_HANDLE_REF_PAYLOAD = "__pwLiteElementHandleRef";
const ABORT_SIGNAL_PAYLOAD = "__pwLiteAbortSignal";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";
let nextAbortSignalId = 0;''')

replace(
'''function callbackSource(callback: unknown, operation: string): string {''',
'''function serializableAbortReason(reason: unknown): unknown {
  if (reason instanceof Error)
    return { __pwLiteAbortError: true, name: reason.name, message: reason.message };
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
    if (signal.aborted && error instanceof Error)
      Object.defineProperty(error, "cause", {
        configurable: true,
        value: signal.reason,
      });
    throw error;
  } finally {
    signal.removeEventListener("abort", forwardAbort);
    await forwarding;
    void realPage
      .evaluate(
        (signalId) => (window as any).__pwLiteAbortSignals?.delete(signalId),
        id
      )
      .catch(() => undefined);
  }
}

function callbackSource(callback: unknown, operation: string): string {''')

replace(
'''      // Everything else: terminal evaluation in browser.
      return async (...args: unknown[]) =>
        evaluateAdapter(
          realPage,
          ({ chain: c, method, args: a }) => {
            const host = window as any;
            return host.__pwLiteInvokeAdapter(() => {
              const current: any = host.__pwLiteReplayAdapterChain(c);
              return current[method](...host.__pwLiteDecodeBridgeValue(a));
            });
          },
          {
            chain: encodeBridgeValueForPage(chain, realPage),
            method: prop as string,
            args: encodeBridgeValueForPage(args, realPage) as any[],
          }
        );''',
'''      // Everything else: terminal evaluation in browser.
      return async (...args: unknown[]) =>
        withAbortSignalBridge(realPage, args, (encodedArgs) =>
          evaluateAdapter(
            realPage,
            ({ chain: c, method, args: a }) => {
              const host = window as any;
              return host.__pwLiteInvokeAdapter(() => {
                const current: any = host.__pwLiteReplayAdapterChain(c);
                return current[method](...host.__pwLiteDecodeBridgeValue(a));
              });
            },
            {
              chain: encodeBridgeValueForPage(chain, realPage),
              method: prop as string,
              args: encodedArgs,
            }
          )
        );''')

replace(
'''function initializeAdapterBridge() {
  const host = window as any;
  host.__pwLiteEvidence = { entered: [], failures: [] };''',
'''function initializeAdapterBridge() {
  const host = window as any;
  host.__pwLiteEvidence = { entered: [], failures: [] };
  host.__pwLiteAbortSignals = new Map<string, AbortController>();
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
  };''')

replace(
'''    if (Array.isArray(value.__pwLiteBytes))
      return Uint8Array.from(value.__pwLiteBytes);''',
'''    if (Array.isArray(value.__pwLiteBytes))
      return Uint8Array.from(value.__pwLiteBytes);
    if (typeof value.__pwLiteAbortSignal === "string") {
      let controller = host.__pwLiteAbortSignals.get(value.__pwLiteAbortSignal);
      if (!controller) {
        controller = new AbortController();
        host.__pwLiteAbortSignals.set(value.__pwLiteAbortSignal, controller);
      }
      if (value.aborted && !controller.signal.aborted)
        controller.abort(abortReason(value.reason));
      return controller.signal;
    }''')

path.write_text(text)
print("abort signal fixture transport applied")
