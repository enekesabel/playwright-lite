import { WrappedHostFunction } from "./hostGlobals";

/**
 * The `fetch` and `XMLHttpRequest` calls the controlled document makes,
 * reported with Playwright's `Request`/`Response` surface.
 *
 * `Request` and `Response` carry only the members the current document can
 * fill from the Fetch API. Playwright fills the rest from the browser's
 * network layer, which no page script can read, so those members are absent
 * from these types instead of returning invented values.
 */

type NativeRequest = globalThis.Request;
type NativeResponse = globalThis.Response;
type NativeFetch = typeof globalThis.fetch;
type NativeRequestInfo = Parameters<NativeFetch>[0];
type NativeRequestInit = Parameters<NativeFetch>[1];
type XhrOpen = typeof XMLHttpRequest.prototype.open;
type XhrSetRequestHeader = typeof XMLHttpRequest.prototype.setRequestHeader;
type XhrSend = typeof XMLHttpRequest.prototype.send;

/** What `open` recorded, until `send` turns it into an observed request. */
type OpenedXhr = {
  method: string;
  url: string;
  /** What `setRequestHeader` accepted, before the browser filtered it. */
  headers: Headers;
  /** Set once `send` reported the request this record describes. */
  sent?: SentXhr;
};

/**
 * Ends a reported request when its `XMLHttpRequest` is opened again. The
 * document's own `load` handler usually runs before this observation's
 * listener and may open the `XMLHttpRequest` for the next request, which
 * discards the body, so the request is settled from its state at that moment.
 */
type SentXhr = {
  /** Called before `open` runs: reports an end whose event was not seen yet. */
  settleIfDone(): void;
  /** Called after `open` succeeded, which cancelled a request in flight. */
  cancel(): void;
};

/** Pinned client/events.ts Page events this observation emits. */
export const NETWORK_EVENTS = [
  "request",
  "response",
  "requestfinished",
  "requestfailed",
] as const;

export type NetworkEventName = (typeof NETWORK_EVENTS)[number];

/** Pinned server/frames.ts `_startNetworkIdleTimer`: the quiet period. */
const NETWORK_IDLE_TIMEOUT = 500;

/** Pinned server/page.ts `addNetworkRequest`: the recent-request bound. */
const REQUEST_LOG_LIMIT = 100;

export interface Request {
  /** The request URL, with the fragment stripped as the pinned server does. */
  url(): string;
  /** `"fetch"` or `"xhr"`: this observation sees only those two, by construction. */
  resourceType(): string;
  method(): string;
  /**
   * The request headers the caller set: `Request.headers` for a `fetch` call,
   * `setRequestHeader` for an `XMLHttpRequest`.
   */
  headers(): Record<string, string>;
  /** Reads `headers()`; a page never sees the headers that went on the wire. */
  headerValue(name: string): Promise<string | null>;
  postData(): string | null;
  postDataBuffer(): Uint8Array | null;
  postDataJSON(): unknown;
  /** Always `false`: neither a `fetch` nor an XHR navigates the document. */
  isNavigationRequest(): boolean;
  failure(): { errorText: string } | null;
  /** Resolves with the response, or `null` once the request has failed. */
  response(): Promise<Response | null>;
}

export interface Response {
  /** The final URL after redirects, which never carries a fragment. */
  url(): string;
  status(): number;
  statusText(): string;
  ok(): boolean;
  /** The response headers the browser exposes to this document. */
  headers(): Record<string, string>;
  headerValue(name: string): Promise<string | null>;
  body(): Promise<Uint8Array>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** Resolves once the response body has ended. */
  finished(): Promise<null>;
  request(): Request;
}

type Emit = (event: NetworkEventName, payload: unknown) => void;

/** Pinned client/page.ts `waitForRequest`/`waitForResponse` first argument. */
export type NetworkMatch<T> =
  string | RegExp | ((target: T) => boolean | Promise<boolean>);

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

/** Pinned server/network.ts `stripFragmentFromUrl`. */
function stripFragmentFromUrl(url: string): string {
  if (!url.includes("#")) return url;
  return url.substring(0, url.indexOf("#"));
}

/** `XMLHttpRequest.open` uppercases these method names before they go out. */
function normalizeXhrMethod(method: string): string {
  return /^(delete|get|head|options|post|put)$/i.test(method)
    ? method.toUpperCase()
    : method;
}

/** Parses `getAllResponseHeaders()`, whose names the browser has lowercased. */
function parseRawHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  return headers;
}

/**
 * The bytes an `XMLHttpRequest` kept. A `responseType` of `"json"` or
 * `"document"` leaves only the value the browser parsed from the body, so the
 * body itself is gone and reading it reports that instead of inventing bytes.
 */
async function xhrResponseBody(xhr: XMLHttpRequest): Promise<Uint8Array> {
  if (xhr.responseType === "json" || xhr.responseType === "document")
    throw new Error(
      `Response body is not available: the request set responseType "${xhr.responseType}".`
    );
  const body: unknown = xhr.response;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body === null) return new Uint8Array();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new Error(
    `Response body is not available: the request set responseType "${xhr.responseType}".`
  );
}

function headersObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

/**
 * The request body a `fetch` init or an `XMLHttpRequest.send` argument
 * carries, in the forms the caller can hand over synchronously. `postData()`
 * answers without waiting, as the pinned client's does, and the call must be
 * forwarded in the same turn; a `Blob`, `FormData` or `ReadableStream` body,
 * and a body carried by a `Request` argument, can only be read
 * asynchronously, so those report `null`.
 */
function readableBody(body: unknown): Uint8Array | null {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams)
    return new TextEncoder().encode(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body))
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  return null;
}

/** What a `fetch` call or an `XMLHttpRequest` reports about its request. */
type ObservedRequestInit = {
  url: string;
  method: string;
  /** The headers the caller set, lowercased. */
  headers: Record<string, string>;
  resourceType: "fetch" | "xhr";
  postData: Uint8Array | null;
};

class ObservedRequest implements Request {
  private readonly _response = deferred<Response | null>();
  private _failureText: string | null = null;

  constructor(private readonly _init: ObservedRequestInit) {}

  url() {
    return stripFragmentFromUrl(this._init.url);
  }

  resourceType() {
    return this._init.resourceType;
  }

  method() {
    return this._init.method;
  }

  headers() {
    return { ...this._init.headers };
  }

  async headerValue(name: string) {
    return this._init.headers[name.toLowerCase()] ?? null;
  }

  postData() {
    return this._init.postData === null
      ? null
      : new TextDecoder().decode(this._init.postData);
  }

  postDataBuffer() {
    return this._init.postData;
  }

  /** Pinned client/network.ts Request.postDataJSON. */
  postDataJSON(): unknown {
    const postData = this.postData();
    if (!postData) return null;
    const contentType = this.headers()["content-type"];
    if (contentType?.includes("application/x-www-form-urlencoded")) {
      const entries: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(postData).entries())
        entries[key] = value;
      return entries;
    }
    try {
      return JSON.parse(postData);
    } catch {
      throw new Error("POST data is not a valid JSON object: " + postData);
    }
  }

  isNavigationRequest() {
    return false;
  }

  failure() {
    return this._failureText === null ? null : { errorText: this._failureText };
  }

  async response(): Promise<Response | null> {
    return await this._response.promise;
  }

  setResponse(response: Response) {
    this._response.resolve(response);
  }

  setFailure(errorText: string) {
    this._failureText = errorText;
    this._response.resolve(null);
  }
}

/** What a `fetch` response or an `XMLHttpRequest` reports about its answer. */
type ObservedResponseInit = {
  url: string;
  status: number;
  statusText: string;
  /** The response headers the browser exposed to this document, lowercased. */
  headers: Record<string, string>;
  /** Reads the response body. Called at most once, and only on demand. */
  readBody: () => Promise<Uint8Array>;
};

class ObservedResponse implements Response {
  private readonly _finished = deferred<null>();
  private _body: Promise<Uint8Array> | undefined;

  constructor(
    private readonly _request: ObservedRequest,
    private readonly _init: ObservedResponseInit
  ) {}

  url() {
    return this._init.url;
  }

  status() {
    return this._init.status;
  }

  statusText() {
    return this._init.statusText;
  }

  /** Pinned client/network.ts Response.ok, which also counts status 0. */
  ok() {
    return (
      this._init.status === 0 ||
      (this._init.status >= 200 && this._init.status <= 299)
    );
  }

  headers() {
    return { ...this._init.headers };
  }

  async headerValue(name: string) {
    return this._init.headers[name.toLowerCase()] ?? null;
  }

  async body(): Promise<Uint8Array> {
    this._body ??= this._init.readBody();
    return await this._body;
  }

  async text() {
    return new TextDecoder().decode(await this.body());
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }

  async finished(): Promise<null> {
    return await this._finished.promise;
  }

  request(): Request {
    return this._request;
  }

  /** Reports that the body has ended, which is what `finished()` waits for. */
  markFinished(): void {
    this._finished.resolve(null);
  }
}

const observations = new WeakMap<Window, NetworkObservation>();

/**
 * The one observation of a window's `fetch` and `XMLHttpRequest`. Every `Page`
 * created for the same window shares it: a second wrapper would wrap the first
 * one's proxy, and unsubscribing in the order they were installed would then
 * leave that proxy behind for good.
 */
export function networkObservationFor(
  browserWindow: Window & typeof globalThis
): NetworkObservation {
  let observation = observations.get(browserWindow);
  if (!observation)
    observations.set(
      browserWindow,
      (observation = new NetworkObservation(browserWindow))
    );
  return observation;
}

/**
 * Reports the `fetch` and `XMLHttpRequest` calls the document makes as
 * Playwright's four network events, for as long as something is subscribed.
 *
 * Playwright observes requests in the browser process, so it sees every
 * resource and every realm. This observation replaces `window.fetch` and
 * `XMLHttpRequest.prototype.open`, `setRequestHeader` and `send`, so it sees
 * this realm's `fetch` calls made after the wrappers were installed and its
 * `XMLHttpRequest`s opened after that, and nothing else. A call is intercepted
 * once and reported to every subscriber.
 */
export class NetworkObservation {
  /**
   * The host functions this observation replaces. They are installed and
   * restored together, so one subscription is one decision about the document.
   */
  private readonly wrappers: readonly { subscribe(): () => void }[];
  /** How many live subscriptions each subscriber holds, so one release of a
   * `Page` that subscribed twice does not stop reporting to it. */
  private readonly subscribers = new Map<Emit, number>();
  /** What `open` recorded for an `XMLHttpRequest` this observation saw. */
  private readonly openedRequests = new WeakMap<XMLHttpRequest, OpenedXhr>();
  /**
   * The reported requests that count for network idle and have not ended.
   * Kept while anything is subscribed, so a `networkidle` wait also sees the
   * requests reported to an earlier subscriber; emptied with the last one.
   */
  private readonly inflight = new Set<Request>();

  constructor(private readonly window: Window & typeof globalThis) {
    const xhr = window.XMLHttpRequest.prototype as unknown as Record<
      string,
      unknown
    >;
    this.wrappers = [
      new WrappedHostFunction<NativeFetch>(
        window as unknown as Record<string, unknown>,
        "fetch",
        (original, thisArg, args) => this.observeFetch(original, thisArg, args)
      ),
      new WrappedHostFunction<XhrOpen>(xhr, "open", (original, thisArg, args) =>
        this.observeOpen(original, thisArg, args)
      ),
      new WrappedHostFunction<XhrSetRequestHeader>(
        xhr,
        "setRequestHeader",
        (original, thisArg, args) =>
          this.observeSetRequestHeader(original, thisArg, args)
      ),
      new WrappedHostFunction<XhrSend>(xhr, "send", (original, thisArg, args) =>
        this.observeSend(original, thisArg, args)
      ),
    ];
  }

  /** Reports to `emit` until the returned release is called. */
  subscribe(emit: Emit): () => void {
    this.subscribers.set(emit, (this.subscribers.get(emit) ?? 0) + 1);
    const releases = this.wrappers.map((wrapper) => wrapper.subscribe());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = (this.subscribers.get(emit) ?? 1) - 1;
      if (held > 0) this.subscribers.set(emit, held);
      else this.subscribers.delete(emit);
      if (this.subscribers.size === 0) this.inflight.clear();
      for (const release of releases) release();
    };
  }

  /**
   * Calls `onIdle` after 500 ms with no observed request in flight, as pinned
   * server/frames.ts fires `networkidle`. Subscribes until the release is called.
   */
  observeIdle(onIdle: () => void): () => void {
    let timer: number | undefined;
    const stopTimer = () => {
      this.window.clearTimeout(timer);
      timer = undefined;
    };
    const startTimer = () => {
      timer = this.window.setTimeout(() => {
        timer = undefined;
        onIdle();
      }, NETWORK_IDLE_TIMEOUT);
    };
    // Another resource's completion restarts a running timer but never holds
    // it; the fetch/XHR entries are already accounted for by the observation.
    const resources = new this.window.PerformanceObserver((list) => {
      const other = list
        .getEntriesByType("resource")
        .some(
          (entry) =>
            !["fetch", "xmlhttprequest"].includes(
              (entry as PerformanceResourceTiming).initiatorType
            )
        );
      if (!other || timer === undefined) return;
      stopTimer();
      startTimer();
    });
    // `emit` has updated the in-flight set before this runs.
    const release = this.subscribe(() => {
      if (this.inflight.size > 0) stopTimer();
      else if (timer === undefined) startTimer();
    });
    resources.observe({ type: "resource" });
    if (this.inflight.size === 0) startTimer();
    return () => {
      resources.disconnect();
      stopTimer();
      release();
    };
  }

  private emit(event: NetworkEventName, payload: unknown) {
    // Pinned server/network.ts `_isFavicon` excludes favicons from networkidle.
    if (event === "request") {
      const request = payload as Request;
      if (!request.url().endsWith("/favicon.ico")) this.inflight.add(request);
    } else if (event === "requestfinished" || event === "requestfailed")
      this.inflight.delete(payload as Request);
    for (const subscriber of [...this.subscribers.keys()])
      subscriber(event, payload);
  }

  private observeFetch(
    original: NativeFetch,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    let request: NativeRequest;
    try {
      // Pinned Fetch: `fetch(input, init)` starts by constructing this same
      // Request, so the caller's input is consumed either way. That constructed
      // Request is what reaches the network, because building it from a
      // body-carrying input leaves the input itself unusable.
      request = new this.window.Request(
        args[0] as NativeRequestInfo,
        args[1] as NativeRequestInit
      );
    } catch {
      // `fetch` reports a malformed input as a rejection, not as a throw.
      // Hand the call over untouched and report nothing.
      return Reflect.apply(original, thisArg, args);
    }

    const postData = readableBody((args[1] as NativeRequestInit)?.body);
    // A receiver the platform rejects still throws here, before anything is
    // reported, so a call that never reached the network reports nothing.
    const result = Reflect.apply(original, thisArg, [
      request,
    ]) as Promise<NativeResponse>;

    const observed = new ObservedRequest({
      url: request.url,
      method: request.method,
      headers: headersObject(request.headers),
      resourceType: "fetch",
      postData,
    });
    this.emit("request", observed);
    void this.follow(observed, result);
    return result;
  }

  private async follow(
    request: ObservedRequest,
    result: Promise<NativeResponse>
  ): Promise<void> {
    let response: ObservedResponse;
    try {
      const native = await result;
      // Clone before the document can consume the body: the clone tees the
      // stream, so both branches still carry the whole body.
      const recording = native.clone();
      response = new ObservedResponse(request, {
        url: native.url,
        status: native.status,
        statusText: native.statusText,
        headers: headersObject(native.headers),
        readBody: async () => new Uint8Array(await recording.arrayBuffer()),
      });
    } catch (error) {
      request.setFailure(failureText(error));
      this.emit("requestfailed", request);
      return;
    }
    request.setResponse(response);
    this.emit("response", response);
    // Read the recording to its end: an unread one would buffer the body
    // indefinitely, and reading it is the only way to learn when it ended.
    try {
      await response.body();
      response.markFinished();
    } catch (error) {
      request.setFailure(failureText(error));
      this.emit("requestfailed", request);
      return;
    }
    this.emit("requestfinished", request);
  }

  /**
   * Records what `open` accepted. Once the original has returned, the receiver
   * is an `XMLHttpRequest` and the URL resolves against the document base;
   * `open` has just discarded the headers set before it, which is why the
   * record starts with none.
   */
  private observeOpen(
    original: XhrOpen,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    const previous = this.openedRequests.get(thisArg as XMLHttpRequest)?.sent;
    previous?.settleIfDone();
    const result = Reflect.apply(original, thisArg, args);
    previous?.cancel();
    this.openedRequests.set(thisArg as XMLHttpRequest, {
      method: normalizeXhrMethod(String(args[0])),
      url: new URL(String(args[1]), this.window.document.baseURI).href,
      headers: new this.window.Headers(),
    });
    return result;
  }

  /** Records a header the original accepted, for `Request.headers`. */
  private observeSetRequestHeader(
    original: XhrSetRequestHeader,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    const result = Reflect.apply(original, thisArg, args);
    this.openedRequests
      .get(thisArg as XMLHttpRequest)
      ?.headers.append(String(args[0]), String(args[1]));
    return result;
  }

  /**
   * Reports the request this `send` starts and the events it produces.
   *
   * The `request` event is emitted before the original runs: a synchronous
   * `XMLHttpRequest` delivers its `load` while `send` is still on the stack,
   * so waiting for the original to return would report the response first.
   *
   * A `send` the platform is about to reject with `InvalidStateError`, and one
   * on an `XMLHttpRequest` opened before the wrappers were installed, is
   * forwarded untouched and reports nothing, so a call that never starts a
   * request leaves nothing of this observation behind.
   */
  private observeSend(
    original: XhrSend,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    const opened = this.openedRequests.get(thisArg as XMLHttpRequest);
    const xhr = thisArg as XMLHttpRequest;
    if (!opened || opened.sent || xhr.readyState !== xhr.OPENED)
      return Reflect.apply(original, thisArg, args);

    const request = new ObservedRequest({
      url: opened.url,
      method: opened.method,
      // The browser drops forbidden names such as `Cookie` from what is sent,
      // and a Request applies the same filter and joins repeated names.
      headers: headersObject(
        new this.window.Request(this.window.document.baseURI, {
          method: opened.method,
          headers: opened.headers,
        }).headers
      ),
      resourceType: "xhr",
      // `send` ignores its body for GET and HEAD, so nothing is sent.
      postData:
        opened.method === "GET" || opened.method === "HEAD"
          ? null
          : readableBody(args[0]),
    });
    let response: ObservedResponse | undefined;
    let ended = false;
    // `xhr.response` holds a partial body until the request is done, and the
    // next `open` discards it, so the body is taken once when it is done, as
    // fetch buffers its own. Reading waits for that, and rejects once the
    // request failed.
    const body = Promise.withResolvers<Uint8Array>();
    body.promise.catch(() => {});
    const respond = (): ObservedResponse => {
      if (!response) {
        response = new ObservedResponse(request, {
          url: xhr.responseURL,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseRawHeaders(xhr.getAllResponseHeaders()),
          readBody: () => body.promise,
        });
        request.setResponse(response);
        this.emit("response", response);
      }
      return response;
    };
    // Each send's listeners are removed once its request has ended, so a
    // reused XMLHttpRequest does not collect them.
    const listeners = new AbortController();
    const fail = (errorText: string) => {
      if (ended) return;
      ended = true;
      listeners.abort();
      body.reject(new Error(errorText));
      request.setFailure(errorText);
      this.emit("requestfailed", request);
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      listeners.abort();
      body.resolve(xhrResponseBody(xhr));
      // A synchronous XMLHttpRequest reports no HEADERS_RECEIVED state, so its
      // response is reported here, still before the request has finished.
      respond().markFinished();
      this.emit("requestfinished", request);
    };
    opened.sent = {
      // A network error and a timeout both end with status 0, and only the
      // event not dispatched yet would tell them apart.
      settleIfDone: () => {
        if (xhr.readyState !== xhr.DONE) return;
        if (xhr.status === 0) fail("XMLHttpRequest: error");
        else finish();
      },
      cancel: () => fail("XMLHttpRequest: abort"),
    };
    const { signal } = listeners;
    xhr.addEventListener(
      "readystatechange",
      () => {
        if (xhr.readyState === xhr.HEADERS_RECEIVED) respond();
        // DONE comes before `load`, whose handlers commonly open the
        // XMLHttpRequest again; status 0 is a failure, told by its own event.
        if (xhr.readyState === xhr.DONE && xhr.status !== 0) finish();
      },
      { signal }
    );
    xhr.addEventListener("load", finish, { signal });
    for (const event of ["error", "timeout", "abort"] as const)
      xhr.addEventListener(event, () => fail(`XMLHttpRequest: ${event}`), {
        signal,
      });

    this.emit("request", request);
    try {
      return Reflect.apply(original, thisArg, args);
    } catch (error) {
      fail(failureText(error));
      throw error;
    }
  }
}

/**
 * Appends to a `Page`'s recent-request log, bounded as pinned server/page.ts
 * `addNetworkRequest` bounds it with `ensureArrayLimit`: once the log passes
 * the limit, its oldest tenth is dropped.
 */
export function recordRequest(log: Request[], request: Request): void {
  log.push(request);
  if (log.length > REQUEST_LOG_LIMIT) log.splice(0, REQUEST_LOG_LIMIT / 10);
}

/**
 * Pinned client/page.ts: a string or `RegExp` matches the observed URL, a
 * function is awaited with the `Request`/`Response` itself.
 */
export function networkPredicate<T extends { url(): string }>(
  urlOrPredicate: NetworkMatch<T>,
  urlMatches: (url: string, match: string | RegExp) => boolean
): (payload: unknown) => boolean | Promise<boolean> {
  return async (payload) => {
    const target = payload as T;
    if (typeof urlOrPredicate === "function")
      return await urlOrPredicate(target);
    return urlMatches(target.url(), urlOrPredicate);
  };
}

/** Pinned client/page.ts `trimUrl`, for the line the timeout reports. */
export function logLineFor(event: string, match: unknown): string {
  if (isRegExp(match))
    return `waiting for ${event} /${trimStringWithEllipsis(match.source, 50)}/${match.flags}`;
  if (typeof match === "string")
    return `waiting for ${event} "${trimStringWithEllipsis(match, 50)}"`;
  return `waiting for event "${event}"`;
}

function isRegExp(value: unknown): value is RegExp {
  return (
    value instanceof RegExp ||
    Object.prototype.toString.call(value) === "[object RegExp]"
  );
}

/** Pinned isomorphic/stringUtils.ts `trimStringWithEllipsis`. */
function trimStringWithEllipsis(input: string, cap: number): string {
  if (input.length <= cap) return input;
  const chars = [...input];
  if (chars.length > cap) return chars.slice(0, cap - 1).join("") + "…";
  return chars.join("");
}

/**
 * Playwright's `failure().errorText` is the browser's `net::ERR_*` code. A
 * page only sees what `fetch` rejected with: a `TypeError` whose message the
 * browser chooses, or the reason an `AbortSignal` carried. An
 * `XMLHttpRequest` carries no error at all, so it reports the name of the
 * event that ended it instead.
 */
function failureText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
