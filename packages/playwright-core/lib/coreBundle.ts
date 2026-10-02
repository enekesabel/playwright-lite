/**
 * Stand-in for the upstream monorepo's built playwright-core bundle.
 *
 * Pinned upstream specs and tests/config/comparator.ts import it through the
 * relative path ../../packages/playwright-core/lib/coreBundle. This repository
 * installs the pinned playwright-core release instead, so the path re-exports
 * that release's own bundle unchanged.
 */
export * from "playwright-core/lib/coreBundle";
