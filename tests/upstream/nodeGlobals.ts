/**
 * Node stand-in for the build's `virtual:playwright-lite-globals`
 * (build/playwrightInjectedPlugin.ts), for the package modules the bridge
 * imports (src/locatorFormatting.ts). In the page those bindings guard against
 * the page replacing its builtins; Node has no page, so each is Node's own
 * global. It exports only the bindings those modules import.
 */
export const { JSON } = globalThis;
