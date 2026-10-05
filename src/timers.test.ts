import { afterEach, describe, expect, it } from "vitest";

import { timersFor } from "./timers";

// Vitest's tab is never really hidden, so these tests report `hidden` the way
// the browser does and check that each wait still fires. The real throttling
// is the `hidden-tab` contract rule's (`pnpm test:hidden-tab`).
function reportHidden() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
});

const timers = timersFor(window);

function elapsed(wait: (done: () => void) => unknown): Promise<number> {
  const started = performance.now();
  return new Promise((resolve) =>
    wait(() => resolve(performance.now() - started))
  );
}

describe("timersFor", () => {
  it("returns one instance per window", () => {
    expect(timersFor(window)).toBe(timers);
  });

  it("fires zero-delay and timed waits while hidden", async () => {
    reportHidden();
    await elapsed((done) => timers.setTimeout(done));
    expect(
      await elapsed((done) => timers.setTimeout(done, 30))
    ).toBeGreaterThanOrEqual(29);
  });

  it("fires an animation frame while hidden", async () => {
    reportHidden();
    await elapsed((done) => timers.requestAnimationFrame(done));
  });

  it("moves a pending wait to the hidden path when the document is hidden", async () => {
    let frames = 0;
    // A frame armed while visible, then cancelled by the switch and re-armed.
    timers.requestAnimationFrame(() => frames++);
    const timed = elapsed((done) => timers.setTimeout(done, 40));
    reportHidden();
    expect(await timed).toBeGreaterThanOrEqual(39);
    expect(frames).toBe(1);
  });

  it("cancels waits on either path", async () => {
    let fired = 0;
    timers.clearTimeout(timers.setTimeout(() => fired++, 10));
    timers.cancelAnimationFrame(timers.requestAnimationFrame(() => fired++));
    reportHidden();
    timers.clearTimeout(timers.setTimeout(() => fired++));
    timers.clearTimeout(timers.setTimeout(() => fired++, 10));
    timers.cancelAnimationFrame(timers.requestAnimationFrame(() => fired++));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fired).toBe(0);
  });

  it("repeats an interval until it is cleared", async () => {
    reportHidden();
    let ticks = 0;
    const id = timers.setInterval(() => ticks++, 5);
    await new Promise((resolve) => setTimeout(resolve, 60));
    timers.clearInterval(id);
    const counted = ticks;
    expect(counted).toBeGreaterThan(2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ticks).toBe(counted);
  });

  it("tells hidden listeners once the document is hidden", () => {
    let told = 0;
    const stop = timers.onHidden(() => told++);
    reportHidden();
    stop();
    reportHidden();
    expect(told).toBe(1);
  });
});
