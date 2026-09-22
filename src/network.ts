import { WrappedHostFunction } from "./hostGlobals";

/**
 * The `fetch` calls the controlled document makes, reported with Playwright's
 * `Request`/`Response` surface.
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

/** Pinned client/events.ts Page events this observation emits. */
export const NETWORK_EVENTS = [
  "request",
  "response",
  "requestfinished",
  "requestfailed",
] as const;

export type NetworkEventName = (typeof NETWORK_EVENTS)[number];

/** Pinned server/page.ts `addNetworkRequest`: the recent-request bound. */
const REQUEST_LOG_LIMIT = 100;

export interface Request {
  /** The request URL, with the fragment stripped as the pinned server does. */
  url(): string;
  /** Always `"fetch"`: this observation sees `fetch` calls by construction. */
  resourceType(): string;
  method(): string;
  /** The author-set request headers, as `Request.headers` reports them. */
  headers(): Record<string, string>;
  /** Reads `headers()`; a page never sees the headers that went on the wire. */
  headerValue(name: string): Promise<string | null>;
  postData(): string | null;
  postDataBuffer(): Uint8Array | null;
  postDataJSON(): unknown;
  /** Always `false`: a `fetch` call never navigates the document. */
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

function headersObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

/**
 * The request body, when the caller passed it in a form this document can read
 * without consuming the stream the browser is about to send. A `Blob`,
 * `FormData` or `ReadableStream` body, and a body carried by a `Request`
 * argument, are readable only through `clone()`, which resolves after the
 * synchronous `postData()` has already been asked; those report `null`.
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

class ObservedRequest implements Request {
  private readonly _url: string;
  private readonly _method: string;
  private readonly _headers: Record<string, string>;
  private readonly _response = deferred<Response | null>();
  private _failureText: string | null = null;

  constructor(
    request: NativeRequest,
    private readonly _postData: Uint8Array | null
  ) {
    this._url = stripFragmentFromUrl(request.url);
    this._method = request.method;
    this._headers = headersObject(request.headers);
  }

  url() {
    return this._url;
  }

  resourceType() {
    return "fetch";
  }

  method() {
    return this._method;
  }

  headers() {
    return { ...this._headers };
  }

  async headerValue(name: string) {
    return this._headers[name.toLowerCase()] ?? null;
  }

  postData() {
    return this._postData === null
      ? null
      : new TextDecoder().decode(this._postData);
  }

  postDataBuffer() {
    return this._postData;
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

class ObservedResponse implements Response {
  private readonly _headers: Record<string, string>;
  private readonly _finished = deferred<null>();
  private _body: Promise<Uint8Array> | undefined;

  constructor(
    private readonly _request: ObservedRequest,
    private readonly _response: NativeResponse,
    /** A clone taken before the document could consume the body. */
    private readonly _recording: NativeResponse
  ) {
    this._headers = headersObject(_response.headers);
  }

  url() {
    return this._response.url;
  }

  status() {
    return this._response.status;
  }

  statusText() {
    return this._response.statusText;
  }

  /** Pinned client/network.ts Response.ok, which also counts status 0. */
  ok() {
    return (
      this._response.status === 0 ||
      (this._response.status >= 200 && this._response.status <= 299)
    );
  }

  headers() {
    return { ...this._headers };
  }

  async headerValue(name: string) {
    return this._headers[name.toLowerCase()] ?? null;
  }

  async body(): Promise<Uint8Array> {
    this._body ??= this._recording
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer));
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

  /**
   * Reads the recorded branch to its end. The document holds the other branch,
   * so an unread recording would buffer the whole body indefinitely, and
   * reading it is also the only way to learn when the body ended.
   */
  async recordBody(): Promise<void> {
    await this.body();
    this._finished.resolve(null);
  }
}

/**
 * Reports the `fetch` calls the document makes as Playwright's four network
 * events, for as long as something is subscribed.
 *
 * Playwright observes requests in the browser process, so it sees every
 * resource and every realm. This observation replaces `window.fetch`, so it
 * sees this realm's `fetch` calls made after the wrapper was installed, and
 * nothing else.
 */
export class NetworkObservation {
  private readonly wrapper: WrappedHostFunction<NativeFetch>;
  private readonly log: Request[] = [];

  constructor(
    private readonly window: Window & typeof globalThis,
    private readonly emit: Emit
  ) {
    this.wrapper = new WrappedHostFunction(
      window as unknown as Record<string, unknown>,
      "fetch",
      (original, thisArg, args) => this.observe(original, thisArg, args)
    );
  }

  subscribe(): () => void {
    return this.wrapper.subscribe();
  }

  /** Pinned client/page.ts Page.requests: the recent requests, oldest first. */
  requests(): Request[] {
    return [...this.log];
  }

  private observe(
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

    const observed = new ObservedRequest(request, postData);
    this.record(observed);
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
      response = new ObservedResponse(request, native, native.clone());
    } catch (error) {
      request.setFailure(failureText(error));
      this.emit("requestfailed", request);
      return;
    }
    request.setResponse(response);
    this.emit("response", response);
    try {
      await response.recordBody();
    } catch (error) {
      request.setFailure(failureText(error));
      this.emit("requestfailed", request);
      return;
    }
    this.emit("requestfinished", request);
  }

  /** Pinned server/page.ts `addNetworkRequest` and its `ensureArrayLimit`. */
  private record(request: Request) {
    this.log.push(request);
    if (this.log.length > REQUEST_LOG_LIMIT)
      this.log.splice(0, REQUEST_LOG_LIMIT / 10);
  }
}

/**
 * Playwright's `failure().errorText` is the browser's `net::ERR_*` code. A
 * page only sees what `fetch` rejected with: a `TypeError` whose message the
 * browser chooses, or the reason an `AbortSignal` carried.
 */
function failureText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
