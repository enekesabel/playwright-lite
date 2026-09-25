import type { Locator } from "@playwright/test";
import { Date, Map, Math, Promise } from "virtual:playwright-lite-globals";
import { asLocator } from "virtual:playwright-lite-injected";

import type { PageImpl } from "./page";

/** The page members a checkpoint reads the document and waits through. */
type LocatorHandlerPage = Pick<
  PageImpl,
  | "window"
  | "resolveAll"
  | "resolveLocatorElement"
  | "elementState"
  | "previewNode"
  | "waitForActionDeadline"
>;

/**
 * The operation running the checkpoint: its whole timeout (0 for none), when
 * it expires, and its signal.
 */
export type CheckpointDeadline = {
  timeout: number;
  expiresAt: number;
  signal?: AbortSignal;
};

export type LocatorHandler = (locator: Locator) => unknown;

type Entry = {
  readonly locator: Locator;
  readonly selector: string;
  readonly handler: LocatorHandler;
  times: number | undefined;
  readonly noWaitAfter: boolean | undefined;
  resolved?: { promise: Promise<void>; resolve(): void };
};

/** Pinned frames.ts retryWithProgressAndBackoff scale. */
const BACKOFF = [20, 50, 100, 100, 500];

/**
 * A page's locator handlers: pinned 26a9e47 client/page.ts
 * `addLocatorHandler`, `removeLocatorHandler` and `_onLocatorHandlerTriggered`
 * together with server/page.ts `registerLocatorHandler`,
 * `resolveLocatorHandler`, `unregisterLocatorHandler` and
 * `_performLocatorHandlersCheckpoint`. The pinned client and server each keep a
 * map of the same handlers; here one map holds both halves, and the handler
 * is called in the page instead of receiving a protocol event.
 */
export class LocatorHandlers {
  private readonly entries = new Map<number, Entry>();
  private lastUid = 0;
  private runningCounter = 0;

  constructor(private readonly page: LocatorHandlerPage) {}

  get size(): number {
    return this.entries.size;
  }

  add(
    locator: Locator,
    selector: string,
    handler: LocatorHandler,
    times: number | undefined,
    noWaitAfter: boolean | undefined
  ): void {
    this.entries.set(++this.lastUid, {
      locator,
      selector,
      handler,
      times,
      noWaitAfter,
    });
  }

  /** Removes every handler registered for an equal locator of this page. */
  remove(selector: string): void {
    for (const [uid, entry] of this.entries)
      if (entry.selector === selector) this.entries.delete(uid);
  }

  /**
   * Whether a checkpoint run now would intercept the operation, for an
   * operation that retries on document observation instead of a loop.
   */
  due(): boolean {
    if (this.runningCounter) return false;
    for (const entry of this.entries.values())
      if (entry.resolved || this.visible(entry.selector)) return true;
    return false;
  }

  /**
   * Runs before an action or assertion attempt. A handler whose locator is
   * visible is called, and the attempt waits for it to finish and, unless
   * `noWaitAfter`, for the locator to be hidden. Nothing runs while any
   * handler is running, so a handler's own actions never re-enter it.
   * `log` receives the call log lines the pinned checkpoint writes. Rejects
   * with `timeoutError()` at the deadline and with the abort error when the
   * signal aborts.
   */
  async checkpoint(
    deadline: CheckpointDeadline,
    log: (line: string) => void,
    timeoutError: () => Error
  ): Promise<void> {
    if (this.runningCounter) return;
    for (const [uid, entry] of this.entries) {
      if (!entry.resolved && this.visible(entry.selector)) {
        let resolve!: () => void;
        const promise = new Promise<void>((settle) => (resolve = settle));
        entry.resolved = { promise, resolve };
        // The counter below is raised before the handler starts, as it is
        // raised before the pinned client receives its event.
        void Promise.resolve()
          .then(() => this.run(uid))
          .catch((error: unknown) =>
            this.page.window.console.error(
              `page.addLocatorHandler(${asLocator("javascript", entry.selector)}): handler failed`,
              error
            )
          );
      }
      if (!entry.resolved) continue;
      ++this.runningCounter;
      const target = asLocator("javascript", entry.selector);
      log(`found ${target}, intercepting action to run the handler`);
      const finished = entry.resolved.promise.then(async () => {
        if (entry.noWaitAfter) {
          log("locator handler has finished");
          return;
        }
        log(`locator handler has finished, waiting for ${target} to be hidden`);
        await this.waitForHidden(entry.selector, deadline, log, timeoutError);
      });
      // A rejection after the deadline settled the wait stays handled.
      finished.catch(() => {});
      try {
        await this.page.waitForActionDeadline(finished, deadline, timeoutError);
      } finally {
        --this.runningCounter;
      }
      log("interception handler has finished, continuing");
    }
  }

  /** The pinned client's handler call, then the server's resolution. */
  private async run(uid: number): Promise<void> {
    let remove = false;
    try {
      const entry = this.entries.get(uid);
      if (entry && entry.times !== 0) {
        if (entry.times !== undefined) entry.times--;
        await entry.handler(entry.locator);
      }
      remove = entry?.times === 0;
    } finally {
      // A handler removed while it ran is no longer found, so the operation
      // waiting for it is never resolved, as in the pinned server.
      const entry = this.entries.get(uid);
      if (remove) this.entries.delete(uid);
      if (entry) {
        entry.resolved?.resolve();
        entry.resolved = undefined;
      }
    }
  }

  /**
   * Pinned frame `isVisibleInternal` with `strict: true`. Every error this
   * document's resolution raises, a strict mode violation or a selector
   * error, is non-retriable there, so it fails the operation.
   */
  private visible(selector: string): boolean {
    const element = this.page.resolveLocatorElement(selector, true);
    return !!element && this.page.elementState(element, "visible").matches;
  }

  /**
   * Pinned frame `waitForSelector` for `state: "hidden"`, without pre-checks,
   * polling with the backoff that `retryWithProgressAndBackoff` caps at a
   * fifth of the timeout.
   */
  private async waitForHidden(
    selector: string,
    deadline: CheckpointDeadline,
    log: (line: string) => void,
    timeoutError: () => Error
  ): Promise<void> {
    const backoff = deadline.timeout
      ? BACKOFF.filter((delay) => delay <= deadline.timeout / 5)
      : BACKOFF;
    for (let retry = 0; ; retry++) {
      if (deadline.signal?.aborted || Date.now() >= deadline.expiresAt)
        throw timeoutError();
      const elements = this.page.resolveAll(selector);
      const element = elements[0];
      if (!element) return;
      const visible = this.page.elementState(element, "visible").matches;
      const preview = this.page.previewNode(element);
      log(
        elements.length > 1
          ? `locator resolved to ${elements.length} elements. Proceeding with the first one: ${preview}`
          : `locator resolved to ${visible ? "visible" : "hidden"} ${preview}`
      );
      if (!visible) return;
      const delay = Math.min(
        backoff[Math.min(retry, backoff.length - 1)] ?? 0,
        Math.max(0, deadline.expiresAt - Date.now())
      );
      await new Promise((resolve) =>
        this.page.window.setTimeout(resolve, delay)
      );
    }
  }
}
