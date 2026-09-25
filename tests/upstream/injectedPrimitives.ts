/**
 * Node stand-in for the build's `virtual:playwright-lite-injected`
 * (build/playwrightInjectedPlugin.ts), so the bridge can import the package's
 * src/locatorFormatting.ts. It supplies the two primitives that module calls,
 * `parseSelector` and `asLocator`, from playwright-core 1.62.1, the release of
 * the pinned commit, whose isomorphic sources the bundled InjectedScript
 * carries too. playwright.config.ts maps the specifier here through
 * tests/upstream/tsconfig.json.
 */
import { iso } from "playwright-core/lib/coreBundle";

export const { asLocator, parseSelector } = iso;
