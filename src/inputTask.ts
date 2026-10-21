import { EventTarget, Promise, Set } from "virtual:playwright-lite-globals";

import { perWindow } from "./hostGlobals";

/**
 * The events one input task can dispatch before the rest go to another:
 * a move's boundary events for an element about 60 levels deep. Each costs a
 * listener on the window's port, added once.
 */
const EVENTS_PER_TASK = 256;

/**
 * The window's input tasks, shared by the pointer and the keyboard: the
 * analogue of the browser dispatching raw input.
 *
 * Chromium dispatches every event of one raw input in one task, and runs
 * every microtask its listeners queue before the next event. Pinned
 * Playwright sends each raw input on its own and waits for it, except that
 * `Mouse.click` without a delay sends its move, presses and releases
 * together, which then land in one task.
 *
 * Here a raw input's events are the listeners of one `MessagePort` message.
 * After each listener the browser runs microtasks, during which the input's
 * code queues its next event before the next listener runs; the first
 * listener that finds nothing queued ends the dispatch. A listener added
 * during a dispatch does not run, so the message has a fixed number.
 */
export interface InputTask {
  /**
   * Resolves at the start of a new raw input: in a task of its own, or in
   * the running one when that started with the same `batch`.
   */
  start(batch?: object): Promise<void>;
  /** Runs `run` as the next event of the raw input in progress. */
  event<T>(run: () => T): Promise<T>;
}

export const inputTaskFor = perWindow(createInputTask);

/** The host's own, taken before a page script such as zone.js can wrap it. */
const addEventListener = EventTarget.prototype.addEventListener;

type Queued = { run: () => void; batch?: object };

function createInputTask(browserWindow: Window & typeof globalThis): InputTask {
  let running: (() => void)[] = [];
  let waiting: Queued[] = [];
  let batches = new Set<object>();
  let dispatching = false;
  let posted = false;
  const { port1, port2 } = new browserWindow.MessageChannel();
  const post = () => {
    if (posted) return;
    posted = true;
    port2.postMessage(null);
  };
  const queue = (run: () => void) => {
    if (dispatching) running.push(run);
    else {
      waiting.push({ run });
      post();
    }
  };
  for (let index = 0; index < EVENTS_PER_TASK; index++)
    addEventListener.call(port1, "message", (event) => {
      if (index === 0) {
        posted = false;
        dispatching = true;
        running = waiting.map(({ run }) => run);
        batches = new Set(waiting.flatMap(({ batch }) => batch ?? []));
        waiting = [];
      }
      const run = running.shift();
      if (run && index < EVENTS_PER_TASK - 1) return run();
      // The input is done, or the message has no listener left for the
      // rest: what is still queued goes to the next task.
      dispatching = false;
      waiting.unshift(...running.map((next) => ({ run: next })));
      running = [];
      if (run) run();
      else event.stopImmediatePropagation();
      if (waiting.length) post();
    });
  port1.start();
  // A port's first message is slow to arrive; send it now rather than with
  // the first input.
  post();
  return {
    start: (batch) =>
      new Promise((resolve) => {
        if (batch && dispatching && batches.has(batch))
          running.push(() => resolve());
        else {
          waiting.push({ run: () => resolve(), batch });
          post();
        }
      }),
    event: (run) =>
      new Promise((resolve, reject) =>
        queue(() => {
          try {
            resolve(run());
          } catch (error) {
            reject(error);
          }
        })
      ),
  };
}
