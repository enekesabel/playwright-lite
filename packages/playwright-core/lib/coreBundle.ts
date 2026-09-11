/**
 * Shim for upstream spec imports.
 * page-set-content.spec.ts imports `../../packages/playwright-core/lib/coreBundle`.
 * This file provides just enough structure for the import to resolve.
 * Tests using these internals are classified harness-unsupported.
 */
export const server = {
  nullProgress: {} as unknown,
};
