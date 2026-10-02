/**
 * Stand-in for the upstream monorepo's built playwright-core utilities bundle.
 *
 * Pinned upstream specs import it through the relative path
 * ../../packages/playwright-core/lib/utilsBundle. This repository installs the
 * pinned playwright-core release instead, so the path re-exports that
 * release's own bundle unchanged.
 */
export * from "playwright-core/lib/utilsBundle";
