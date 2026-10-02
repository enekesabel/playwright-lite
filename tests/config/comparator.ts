/**
 * Package-local copy of Playwright's tests/config/comparator.ts.
 *
 * Upstream specs compare captured PNGs with the pinned client's own image
 * comparator, imported through the relative path ../config/comparator.
 */
import { utils } from "../../packages/playwright-core/lib/coreBundle";

const { getComparator } = utils;

const pngComparator = getComparator("image/png");
type ComparatorResult = { diff?: Buffer; errorMessage: string } | null;
type ImageComparatorOptions = {
  threshold?: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
};

export function comparePNGs(
  actual: Buffer,
  expected: Buffer,
  options: ImageComparatorOptions = {}
): ComparatorResult {
  // Strict threshold by default in our tests.
  return pngComparator(actual, expected, {
    comparator: "ssim-cie94",
    threshold: 0,
    ...options,
  });
}
