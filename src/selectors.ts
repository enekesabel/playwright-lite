export { getByTestIdSelector } from "virtual:ayme-playwright-injected";

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
