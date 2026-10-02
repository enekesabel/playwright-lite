import { afterEach, expect } from "vitest";

/**
 * Web fonts whose load the test holds pending. Each one is removed again
 * when its test ends, so `document.fonts.ready` never waits on another
 * test's font.
 */

const added = new Set<FontFace>();

afterEach(() => {
  for (const face of added) document.fonts.delete(face);
  added.clear();
});

/**
 * Adds a web font that stays loading for `ms` milliseconds, then fails, and
 * returns a function that removes it.
 */
export function pendingFont(ms: number): () => void {
  const face = new FontFace("pending", `url(/__delay/${ms}/font.woff2)`);
  document.fonts.add(face);
  added.add(face);
  face.load().catch(() => {});
  expect(document.fonts.status).toBe("loading");
  return () => {
    document.fonts.delete(face);
    added.delete(face);
  };
}
