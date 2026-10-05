import { Map, Math, Set } from "virtual:playwright-lite-globals";

import { perWindow } from "./hostGlobals";

type BrowserWindow = Window & typeof globalThis;

/**
 * The window's timers and animation frames, kept at their foreground pace
 * while the document is hidden.
 *
 * A browser stops animation frames in a hidden tab and clamps its timers to
 * about one per second, and to about one per minute once the tab has been
 * hidden for minutes. Playwright never meets that: it launches the browser
 * with background throttling off. This adapter runs inside the user's tab, so
 * while `document.visibilityState` is `"hidden"`:
 *
 * - a zero-delay timer runs as a MessageChannel task, which is never
 *   throttled and still crosses a task boundary;
 * - a timed wait runs on a timer inside a dedicated worker, which background
 *   throttling does not reach; where the page's Content Security Policy
 *   blocks the worker, it falls back to the window's clamped timer;
 * - an animation frame becomes a timed wait of one frame.
 *
 * While the document is visible, every call goes straight to the window's own
 * function. A wait armed while visible moves to the hidden path when the
 * document is hidden before it fires.
 */
export interface Timers {
  setTimeout(callback: () => void, delay?: number): number;
  clearTimeout(id: number | undefined): void;
  setInterval(callback: () => void, delay: number): number;
  clearInterval(id: number | undefined): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number | undefined): void;
  /** Calls `callback` when the document is hidden; returns its removal. */
  onHidden(callback: () => void): () => void;
}

/** One frame at 60 Hz, which a hidden document's animation frame waits for. */
const FRAME_MS = 16;

const WORKER_SOURCE =
  "onmessage = ({ data: [id, delay] }) => setTimeout(() => postMessage(id), delay);";

interface Pending {
  readonly fire: (time: number) => void;
  readonly frame: boolean;
  readonly due: number;
  /** Cancels the visible arming; undefined once armed on the hidden path. */
  cancelVisible?: () => void;
}

export const timersFor = perWindow(createTimers);

function createTimers(browserWindow: BrowserWindow): Timers {
  const document = browserWindow.document;
  const pending = new Map<number, Pending>();
  const hiddenListeners = new Set<() => void>();
  let lastId = 0;
  let channel: MessagePort | undefined;
  let worker: Worker | null | undefined;
  let listening = false;

  const hidden = () => document.visibilityState === "hidden";
  const now = () => browserWindow.performance.now();

  const fire = (id: number, time = now()) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.fire(time);
  };

  const zeroDelayTask = (id: number) => {
    if (!channel) {
      const { port1, port2 } = new browserWindow.MessageChannel();
      port1.onmessage = ({ data }) => fire(data as number);
      channel = port2;
    }
    channel.postMessage(id);
  };

  const workerTimer = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
      const url = browserWindow.URL.createObjectURL(
        new browserWindow.Blob([WORKER_SOURCE], { type: "text/javascript" })
      );
      worker = new browserWindow.Worker(url);
      browserWindow.URL.revokeObjectURL(url);
      worker.onmessage = ({ data }) => fire(data as number);
      // A policy that blocks the worker can also report it asynchronously.
      worker.onerror = () => {
        worker = null;
        for (const [id, entry] of pending)
          if (!entry.cancelVisible) armClamped(id, entry);
      };
    } catch {
      worker = null;
    }
    return worker;
  };

  const armClamped = (id: number, entry: Pending) => {
    browserWindow.setTimeout(() => fire(id), Math.max(0, entry.due - now()));
  };

  const armHidden = (id: number, entry: Pending) => {
    entry.cancelVisible = undefined;
    const delay = entry.frame ? FRAME_MS : Math.max(0, entry.due - now());
    if (delay === 0) return zeroDelayTask(id);
    const timer = workerTimer();
    if (timer) timer.postMessage([id, delay]);
    else armClamped(id, entry);
  };

  const armVisible = (id: number, entry: Pending) => {
    if (entry.frame) {
      const frame = browserWindow.requestAnimationFrame((time) =>
        fire(id, time)
      );
      entry.cancelVisible = () => browserWindow.cancelAnimationFrame(frame);
    } else {
      const timer = browserWindow.setTimeout(
        () => fire(id),
        Math.max(0, entry.due - now())
      );
      entry.cancelVisible = () => browserWindow.clearTimeout(timer);
    }
  };

  const onVisibilityChange = () => {
    if (!hidden()) return;
    for (const [id, entry] of pending) {
      if (!entry.cancelVisible) continue;
      entry.cancelVisible();
      armHidden(id, entry);
    }
    for (const listener of [...hiddenListeners]) listener();
  };

  const schedule = (
    fire: (time: number) => void,
    delay: number,
    frame: boolean
  ): number => {
    if (!listening) {
      listening = true;
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    const id = ++lastId;
    const entry: Pending = { fire, frame, due: now() + delay };
    pending.set(id, entry);
    if (hidden()) armHidden(id, entry);
    else armVisible(id, entry);
    return id;
  };

  const cancel = (id: number | undefined) => {
    if (id === undefined) return;
    pending.get(id)?.cancelVisible?.();
    pending.delete(id);
  };

  /** Interval ids map to the id of the timer currently armed for them. */
  const intervals = new Map<number, number>();

  return {
    setTimeout(callback, delay = 0) {
      return schedule(callback, Math.max(0, delay), false);
    },
    clearTimeout: cancel,
    setInterval(callback, delay) {
      const id = ++lastId;
      const next = () =>
        intervals.set(
          id,
          schedule(
            () => {
              next();
              callback();
            },
            Math.max(0, delay),
            false
          )
        );
      next();
      return id;
    },
    clearInterval(id) {
      if (id === undefined) return;
      cancel(intervals.get(id));
      intervals.delete(id);
    },
    requestAnimationFrame(callback) {
      return schedule(callback, FRAME_MS, true);
    },
    cancelAnimationFrame(id) {
      cancel(id);
    },
    onHidden(callback) {
      if (!listening) {
        listening = true;
        document.addEventListener("visibilitychange", onVisibilityChange);
      }
      hiddenListeners.add(callback);
      return () => hiddenListeners.delete(callback);
    },
  };
}
