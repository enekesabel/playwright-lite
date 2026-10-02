import { afterEach, expect } from "vitest";

/**
 * Web fonts a test adds. Each one is removed again when its test ends, so
 * `document.fonts.ready` never waits on another test's font.
 */

const added = new Set<FontFace>();
const declarations = new Set<HTMLStyleElement>();

afterEach(() => {
  for (const face of added) document.fonts.delete(face);
  added.clear();
  for (const style of declarations) style.remove();
  declarations.clear();
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

/**
 * Declares the pinned fixture font, whose glyphs are filled black rectangles,
 * as `family` in an `@font-face` rule for the rest of the test, and loads it.
 */
export async function webFont(family: string): Promise<void> {
  const style = document.createElement("style");
  style.textContent = `@font-face { font-family: "${family}"; src: url(/tests/assets/webfont/iconfont.woff2) }`;
  document.head.append(style);
  declarations.add(style);
  await document.fonts.load(`16px "${family}"`, "+");
}
