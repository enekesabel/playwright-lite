import {
  asLocator,
  parseSelector,
  type ParsedSelector,
} from "virtual:playwright-lite-injected";
import { JSON } from "virtual:playwright-lite-globals";

/**
 * Mirrors pinned 26a9e47 isomorphic/locatorGenerators.ts
 * `asLocatorDescription('javascript', selector)`, which the pinned
 * `Locator.toString()` returns. The bundle drops that wrapper, so it is
 * rebuilt from the bundled `parseSelector` and `asLocator` it calls.
 */
export function asLocatorDescription(selector: string): string {
  try {
    const customDescription = parseCustomDescription(parseSelector(selector));
    if (customDescription) return customDescription;
    return asLocator("javascript", selector);
  } catch {
    // Tolerate invalid input.
    return selector;
  }
}

/**
 * Mirrors pinned 26a9e47 isomorphic/locatorGenerators.ts
 * `locatorCustomDescription`, which the pinned `Locator.description()` reads.
 */
export function locatorCustomDescription(selector: string): string | undefined {
  try {
    return parseCustomDescription(parseSelector(selector));
  } catch {
    return undefined;
  }
}

function parseCustomDescription(parsed: ParsedSelector): string | undefined {
  const lastPart = parsed.parts[parsed.parts.length - 1];
  if (lastPart?.name === "internal:describe") {
    const description: unknown = JSON.parse(lastPart.body as string);
    if (typeof description === "string") return description;
  }
  return undefined;
}
