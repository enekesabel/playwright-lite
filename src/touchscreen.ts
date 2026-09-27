import type { Touchscreen } from "@playwright/test";
import { Error } from "virtual:playwright-lite-globals";

import {
  guardLifetimeCalls,
  type LifetimeCalls,
  type PageLifetime,
} from "./lifetime";
import type { Pointer } from "./mouse";
import { validateFloat } from "./protocolValidation";

/**
 * The document's stand-in for the `hasTouch` context option: Chromium
 * reports touch points only when touch is emulated or present.
 */
export function supportsTouch(window: Window): boolean {
  return window.navigator.maxTouchPoints > 0;
}

/** Refused once the touchscreen's page has closed; see `guardLifetimeCalls`. */
const TOUCHSCREEN_LIFETIME_CALLS: Record<
  LifetimeCalls<BrowserTouchscreen, Touchscreen>,
  true
> = { tap: true };

/**
 * `page.touchscreen`: the pinned client `Touchscreen`, its arguments checked
 * the way the pinned protocol does, tapping with the Page's one `Pointer`.
 */
export class BrowserTouchscreen implements Touchscreen {
  static {
    guardLifetimeCalls(
      BrowserTouchscreen.prototype,
      TOUCHSCREEN_LIFETIME_CALLS,
      "touchscreen",
      (touchscreen) => touchscreen.#lifetime
    );
  }

  readonly #pointer: Pointer;
  readonly #lifetime: PageLifetime;
  readonly #window: Window;

  constructor(pointer: Pointer, lifetime: PageLifetime, window: Window) {
    this.#pointer = pointer;
    this.#lifetime = lifetime;
    this.#window = window;
  }

  /** Pinned server/input.ts `Touchscreen.apiTap`, with no timeout. */
  async tap(x: number, y: number): Promise<void> {
    try {
      const point = { x: validateFloat(x, "x"), y: validateFloat(y, "y") };
      if (!supportsTouch(this.#window))
        throw new Error(
          "hasTouch must be enabled on the browser context before using the touchscreen."
        );
      await this.#pointer.tap(point, { action: "touchscreen.tap" });
    } catch (error) {
      if (error instanceof Error)
        error.message = `touchscreen.tap: ${error.message}`;
      throw error;
    }
  }
}
