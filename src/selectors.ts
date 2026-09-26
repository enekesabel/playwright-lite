import type { Selectors } from "@playwright/test";
import { Error, JSON, Set } from "virtual:playwright-lite-globals";

import { registerSelectorEngine } from "./injected";

export { getByTestIdSelector } from "virtual:playwright-lite-injected";

type SelectorEngineScript =
  | string
  | ((...args: unknown[]) => unknown)
  | { path?: string; content?: string };

/**
 * Pinned server/selectors.ts `_builtinEngines` ("keep in sync with
 * InjectedScript class"), plus the `zs` name it keeps for future use. Its
 * `zs:light`, like every name with a colon, fails the name check first.
 */
const predefinedEngines = new Set([
  "css",
  "css:light",
  "xpath",
  "xpath:light",
  "_react",
  "_vue",
  "text",
  "text:light",
  "id",
  "id:light",
  "data-testid",
  "data-testid:light",
  "data-test-id",
  "data-test-id:light",
  "data-test",
  "data-test:light",
  "nth",
  "visible",
  "internal:control",
  "internal:has",
  "internal:has-not",
  "internal:has-text",
  "internal:has-not-text",
  "internal:and",
  "internal:or",
  "internal:chain",
  "role",
  "internal:attr",
  "internal:label",
  "internal:text",
  "internal:role",
  "internal:testid",
  "internal:describe",
  "aria-ref",
  "zs",
]);

/**
 * Pinned client/clientHelper.ts `evaluationScript(script, undefined, false)`,
 * which reads `path` from disk; this runtime has no file system to read.
 */
function engineSource(script: SelectorEngineScript): unknown {
  if (typeof script === "function") return `(${script.toString()})(undefined)`;
  if (typeof script === "string") return script;
  if (script.content !== undefined) return script.content;
  if (script.path !== undefined)
    throw new Error(
      "selectors.register: the `path` property is not supported; pass `content`."
    );
  throw new Error("Either path or content property must be present");
}

/** A protocol or server rejection, which the pinned client prefixes. */
function fail(message: string): never {
  throw new Error(`selectors.register: ${message}`);
}

/** Pinned protocol `tString`, reported through `fail`. */
function protocolString(value: unknown, path: string): string {
  if (value instanceof String) return value.valueOf();
  if (typeof value === "string") return value;
  return fail(`${path}: expected string, got ${typeof value}`);
}

/**
 * Pinned client/selectors.ts `Selectors.register`, followed by the checks the
 * pinned protocol validator and server/selectors.ts `register` apply once the
 * engine reaches a browser context. The current document always has one, so
 * they always apply. `contentScript` is validated and has no effect: engines
 * run in the page's own JavaScript world, the only one there is.
 */
class SelectorsImpl {
  private readonly names = new Set<string>();

  async register(
    name: string,
    script: SelectorEngineScript,
    options: { contentScript?: boolean } = {}
  ): Promise<void> {
    if (this.names.has(name))
      throw new Error(
        `selectors.register: "${name}" selector engine has been already registered`
      );
    const engine = { ...options, name, source: engineSource(script) };
    const engineName = protocolString(engine.name, "selectorEngine.name");
    const source = protocolString(engine.source, "selectorEngine.source");
    const contentScript = engine.contentScript as unknown;
    if (
      contentScript !== undefined &&
      typeof contentScript !== "boolean" &&
      !(contentScript instanceof Boolean)
    )
      fail(
        `selectorEngine.contentScript: expected boolean, got ${typeof contentScript}`
      );
    if (!/^[a-zA-Z_0-9-]+$/.test(engineName))
      fail("Selector engine name may only contain [a-zA-Z0-9_] characters");
    if (predefinedEngines.has(engineName))
      fail(`"${engineName}" is a predefined selector engine`);
    registerSelectorEngine(engineName, source);
    this.names.add(engineName);
  }
}

/**
 * Playwright's `selectors`. A registered engine resolves in every `Page` of
 * this package, including those created before it was registered.
 */
export const selectors = new SelectorsImpl() as unknown as Selectors;

export function escapeForAttributeSelector(
  value: string | RegExp,
  exact: boolean
): string {
  if (typeof value !== "string") return escapeRegexForSelector(value);
  return `"${value.replace(/\\/g, "\\\\").replace(/["]/g, '\\"')}"${exact ? "s" : "i"}`;
}

export function escapeForTextSelector(
  text: string | RegExp,
  exact: boolean
): string {
  if (typeof text !== "string") return escapeRegexForSelector(text);
  return `${JSON.stringify(text)}${exact ? "s" : "i"}`;
}

export function getByRoleSelector(
  role: string,
  options: {
    name?: string | RegExp;
    exact?: boolean;
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    includeHidden?: boolean;
    level?: number;
    pressed?: boolean;
    selected?: boolean;
    description?: string | RegExp;
  } = {}
): string {
  const props: [string, string][] = [];
  if (options.checked !== undefined)
    props.push(["checked", String(options.checked)]);
  if (options.disabled !== undefined)
    props.push(["disabled", String(options.disabled)]);
  if (options.selected !== undefined)
    props.push(["selected", String(options.selected)]);
  if (options.expanded !== undefined)
    props.push(["expanded", String(options.expanded)]);
  if (options.includeHidden !== undefined)
    props.push(["include-hidden", String(options.includeHidden)]);
  if (options.level !== undefined) props.push(["level", String(options.level)]);
  if (options.name !== undefined)
    props.push([
      "name",
      escapeForAttributeSelector(options.name, !!options.exact),
    ]);
  if (options.description !== undefined)
    props.push([
      "description",
      escapeForAttributeSelector(options.description, !!options.exact),
    ]);
  if (options.pressed !== undefined)
    props.push(["pressed", String(options.pressed)]);
  return `internal:role=${role}${props.map(([n, v]) => `[${n}=${v}]`).join("")}`;
}

export function getByTextSelector(text: string | RegExp, exact = false) {
  return `internal:text=${escapeForTextSelector(text, exact)}`;
}

export function getByLabelSelector(text: string | RegExp, exact = false) {
  return `internal:label=${escapeForTextSelector(text, exact)}`;
}

export function getByPlaceholderSelector(text: string | RegExp, exact = false) {
  return `internal:attr=[placeholder=${escapeForAttributeSelector(text, exact)}]`;
}

export function getByAltTextSelector(text: string | RegExp, exact = false) {
  return `internal:attr=[alt=${escapeForAttributeSelector(text, exact)}]`;
}

export function getByTitleSelector(text: string | RegExp, exact = false) {
  return `internal:attr=[title=${escapeForAttributeSelector(text, exact)}]`;
}

/**
 * Mirrors Playwright's `escapeRegexForSelector` from `@isomorphic/stringUtils`.
 * Escapes quotes and `>>` in regex literals for use inside internal selectors.
 */
function escapeRegexForSelector(re: RegExp): string {
  // Unicode mode does not allow "identity character escapes", so we do not escape and
  // hope that it does not contain quotes and/or >> signs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (re.unicode || (re as any).unicodeSets) return String(re);
  // Even number of backslashes followed by the quote -> insert a backslash.
  return String(re)
    .replace(/(^|[^\\])(\\\\)*(["'`])/g, "$1$2\\$3")
    .replace(/>>/g, "\\>\\>");
}
