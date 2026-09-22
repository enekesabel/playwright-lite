import type {
  Page as PlaywrightPage,
  PlaywrightTestOptions,
} from "@playwright/test";

export { expect } from "./expect";
export type { Expect } from "./expect";
export type { Request, Response } from "./network";

import { PageImpl } from "./page";
import type { Request, Response } from "./network";

export type CreatePageOptions = Partial<
  Pick<
    PlaywrightTestOptions,
    "testIdAttribute" | "actionTimeout" | "navigationTimeout"
  >
>;

type NetworkWaitOptions = { signal?: AbortSignal; timeout?: number };
type NetworkPredicateOptions<T> =
  | ((target: T) => boolean | Promise<boolean>)
  | (NetworkWaitOptions & {
      predicate?: (target: T) => boolean | Promise<boolean>;
    });

/**
 * The network members whose objects are this package's `Request` and
 * `Response`: subsets of Playwright's, carrying only what the current document
 * can fill. Declared before Playwright's own signatures so these four event
 * names and the three members resolve to them.
 */
interface NetworkSurface {
  on(event: "request", listener: (request: Request) => void): Page;
  on(event: "response", listener: (response: Response) => void): Page;
  on(event: "requestfinished", listener: (request: Request) => void): Page;
  on(event: "requestfailed", listener: (request: Request) => void): Page;
  addListener(event: "request", listener: (request: Request) => void): Page;
  addListener(event: "response", listener: (response: Response) => void): Page;
  addListener(
    event: "requestfinished",
    listener: (request: Request) => void
  ): Page;
  addListener(
    event: "requestfailed",
    listener: (request: Request) => void
  ): Page;
  prependListener(event: "request", listener: (request: Request) => void): Page;
  prependListener(
    event: "response",
    listener: (response: Response) => void
  ): Page;
  prependListener(
    event: "requestfinished",
    listener: (request: Request) => void
  ): Page;
  prependListener(
    event: "requestfailed",
    listener: (request: Request) => void
  ): Page;
  once(event: "request", listener: (request: Request) => void): Page;
  once(event: "response", listener: (response: Response) => void): Page;
  once(event: "requestfinished", listener: (request: Request) => void): Page;
  once(event: "requestfailed", listener: (request: Request) => void): Page;
  off(event: "request", listener: (request: Request) => void): Page;
  off(event: "response", listener: (response: Response) => void): Page;
  off(event: "requestfinished", listener: (request: Request) => void): Page;
  off(event: "requestfailed", listener: (request: Request) => void): Page;
  removeListener(event: "request", listener: (request: Request) => void): Page;
  removeListener(
    event: "response",
    listener: (response: Response) => void
  ): Page;
  removeListener(
    event: "requestfinished",
    listener: (request: Request) => void
  ): Page;
  removeListener(
    event: "requestfailed",
    listener: (request: Request) => void
  ): Page;
  waitForEvent(
    event: "request" | "requestfinished" | "requestfailed",
    optionsOrPredicate?: NetworkPredicateOptions<Request>
  ): Promise<Request>;
  waitForEvent(
    event: "response",
    optionsOrPredicate?: NetworkPredicateOptions<Response>
  ): Promise<Response>;
  waitForRequest(
    urlOrPredicate:
      string | RegExp | ((request: Request) => boolean | Promise<boolean>),
    options?: NetworkWaitOptions
  ): Promise<Request>;
  waitForResponse(
    urlOrPredicate:
      string | RegExp | ((response: Response) => boolean | Promise<boolean>),
    options?: NetworkWaitOptions
  ): Promise<Response>;
  requests(): Promise<Request[]>;
}

/** Playwright's `Page`, with this package's network objects. */
export type Page = NetworkSurface & PlaywrightPage;

/** Creates a Page for the current browser window. Omitted settings keep the runtime defaults. */
export function createPage(options: CreatePageOptions = {}): Page {
  if (
    options.testIdAttribute !== undefined &&
    (typeof options.testIdAttribute !== "string" ||
      !options.testIdAttribute.trim())
  ) {
    throw new TypeError("testIdAttribute must be a non-empty string.");
  }
  for (const name of ["actionTimeout", "navigationTimeout"] as const) {
    const value = options[name];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      throw new TypeError(`${name} must be a finite, non-negative number.`);
    }
  }
  const page = PageImpl.fromWindow(window, options.testIdAttribute);
  if (options.actionTimeout !== undefined)
    page.setDefaultTimeout(options.actionTimeout);
  if (options.navigationTimeout !== undefined)
    page.setDefaultNavigationTimeout(options.navigationTimeout);
  return page as unknown as Page;
}
