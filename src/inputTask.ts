import { Promise } from "virtual:playwright-lite-globals";

import { perWindow } from "./hostGlobals";

/** The events one input task can dispatch before the rest go to another. */
const EVENTS_PER_TASK = 64;

/**
 * Runs `event` as the next event of the input in progress: the analogue of
 * the browser dispatching one event of a raw input.
 */
export type InputTask = <T>(event: () => T) => Promise<T>;

/**
 * The window's input task, shared by the pointer and the keyboard.
 *
 * Chromium dispatches each event of a raw input from the browser, so every
 * microtask its listeners queue runs before the next event, and input sent
 * back to back, like a click's move, press and release, lands in one task.
 * Here each event is one listener of a single `MessagePort` message, after
 * which the browser runs microtasks the same way, and the caller's
 * continuation queues the next event before the next listener runs. A new
 * task starts only when none is running. A listener added during a dispatch
 * does not run, so the task has a fixed number; events past it, like a long
 * stepped move's, go on in the next task.
 */
export const inputTaskFor = perWindow(createInputTask);

function createInputTask(browserWindow: Window & typeof globalThis): InputTask {
  const events: (() => void)[] = [];
  let dispatching = false;
  let posted = false;
  const { port1, port2 } = new browserWindow.MessageChannel();
  const post = () => {
    if (dispatching || posted) return;
    posted = true;
    port2.postMessage(null);
  };
  for (let index = 0; index < EVENTS_PER_TASK; index++)
    port1.addEventListener("message", () => {
      if (index === 0) {
        posted = false;
        dispatching = true;
      }
      events.shift()?.();
      if (index < EVENTS_PER_TASK - 1) return;
      dispatching = false;
      if (events.length) post();
    });
  port1.start();
  return (event) =>
    new Promise((resolve, reject) => {
      events.push(() => {
        try {
          resolve(event());
        } catch (error) {
          reject(error);
        }
      });
      post();
    });
}
