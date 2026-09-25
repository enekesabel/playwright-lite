import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Handlebars from "handlebars";
import { format, resolveConfig } from "prettier";

import {
  pageLedger,
  locatorLedger,
  locatorAssertionLedger,
  pageAssertionLedger,
  genericExpectLedger,
  events,
  excludedEvents,
  objectSections,
} from "../compatibility/api.ts";

const projectRoot = new URL("../", import.meta.url);

const specialMemberUrls = new Map([
  [
    "Symbol.asyncDispose",
    "https://playwright.dev/docs/release-notes#version-160",
  ],
  ["addListener", "https://playwright.dev/docs/events"],
  ["off", "https://playwright.dev/docs/events"],
  ["on", "https://playwright.dev/docs/events"],
  ["once", "https://playwright.dev/docs/events"],
  ["prependListener", "https://playwright.dev/docs/events"],
  ["removeListener", "https://playwright.dev/docs/events"],
]);
const selectorAliases = new Map([
  ["$", "query-selector"],
  ["$$", "query-selector-all"],
  ["$eval", "eval-on-selector"],
  ["$$eval", "eval-on-selector-all"],
]);

const genericExpectUrls = new Map([
  ["expect(value)", "https://playwright.dev/docs/api/class-genericassertions"],
  [
    "expect.extend()",
    "https://playwright.dev/docs/test-assertions#add-custom-matchers-using-expectextend",
  ],
  [
    "expect.configure()",
    "https://playwright.dev/docs/test-assertions#expectconfigure",
  ],
  ["expect.poll()", "https://playwright.dev/docs/test-assertions#expectpoll"],
  ["toPass()", "https://playwright.dev/docs/test-assertions#expecttopass"],
  [
    "expect.soft()",
    "https://playwright.dev/docs/test-assertions#soft-assertions",
  ],
]);

// Page event names are one lowercase word; their anchors split the words.
const eventAnchors = new Map([
  ["framenavigated", "frame-navigated"],
  ["pageerror", "page-error"],
  ["requestfailed", "request-failed"],
  ["requestfinished", "request-finished"],
]);

function eventUrl(name) {
  return `https://playwright.dev/docs/api/class-page#page-event-${eventAnchors.get(name) ?? name}`;
}

// Overloaded members whose first documented form carries a numeric suffix.
const suffixedAnchors = new Set(["toHaveScreenshot"]);

function kebab(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/** Links a member of a Playwright API class, e.g. `class-page#page-click`. */
function classMemberUrl(owner, anchorPrefix = owner) {
  return (name) => {
    const anchor = selectorAliases.get(name) ?? kebab(name);
    const suffix = suffixedAnchors.has(name) ? "-1" : "";
    return `https://playwright.dev/docs/api/class-${owner}#${anchorPrefix}-${anchor}${suffix}`;
  };
}

function memberUrl(owner) {
  const url = classMemberUrl(owner);
  return (name) => specialMemberUrls.get(name) ?? url(name);
}

/** Plain-text category rows carry no API name to format or link. */
function isCategory(name) {
  return /^[A-Z]/.test(name) && name.includes(" ");
}

function rowsFor(ledger, url, showAllNotes = false) {
  return Reflect.ownKeys(ledger)
    .map((key) => {
      const entry = ledger[key];
      const name =
        key === Symbol.asyncDispose ? "Symbol.asyncDispose" : String(key);
      const partial =
        entry.status === "implemented" && entry.apiCompatibility === "partial";
      const excluded = entry.status === "out-of-scope";
      if ((partial || excluded) && !entry.limitations?.trim())
        throw new Error(`Missing compatibility note for ${name}`);
      const label =
        key === Symbol.asyncDispose ? "[Symbol.asyncDispose]()" : name;
      return {
        name,
        label: isCategory(name) ? label : `\`${label}\``,
        url: isCategory(name) ? undefined : url(name),
        status:
          entry.status === "implemented"
            ? partial
              ? "⚠️"
              : "✅"
            : excluded
              ? "🚫"
              : "❌",
        note:
          (showAllNotes
            ? entry.limitations
            : partial || excluded
              ? entry.limitations
              : ""
          )
            ?.replaceAll("|", "&#124;")
            .replace(/\r?\n/g, "<br>") ?? "",
      };
    })
    .sort(
      (a, b) =>
        isCategory(a.name) - isCategory(b.name) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
}

export async function renderReadme(root = projectRoot) {
  const filepath = fileURLToPath(new URL("README.md", root));
  const [template, packageJson, options] = await Promise.all([
    readFile(new URL("docs/readme-template.hbs", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    resolveConfig(filepath),
  ]);
  const pkg = JSON.parse(packageJson);
  const markdown = Handlebars.compile(template, { strict: true })({
    playwrightVersion: pkg.devDependencies["@playwright/test"],
    apiTables: [
      { name: "Page", rows: rowsFor(pageLedger, memberUrl("page")) },
      { name: "Locator", rows: rowsFor(locatorLedger, memberUrl("locator")) },
    ],
    events: events.map((row) => ({
      ...row,
      events: row.events.map((name) => ({ name, url: eventUrl(name) })),
    })),
    excludedEvents: excludedEvents.map((row) => ({
      ...row,
      url: eventUrl(row.event),
    })),
    expectTables: [
      {
        name: "Locator assertions",
        receiver: "expect(locator)",
        rows: rowsFor(
          locatorAssertionLedger,
          classMemberUrl("locatorassertions", "locator-assertions"),
          true
        ),
      },
      {
        name: "Page assertions",
        receiver: "expect(page)",
        rows: rowsFor(
          pageAssertionLedger,
          classMemberUrl("pageassertions", "page-assertions"),
          true
        ),
      },
      {
        name: "Generic expect",
        rows: rowsFor(
          genericExpectLedger,
          (name) => genericExpectUrls.get(name),
          true
        ),
      },
    ],
    // Strict templates reject missing fields; an omitted field renders nothing.
    objectSections: objectSections.map((section) => ({
      reported: "",
      notReported: "",
      covers: "",
      notAvailable: "",
      members: [],
      differences: [],
      edgeCases: [],
      ...section,
    })),
  });
  return format(markdown, { ...options, filepath });
}

export async function generateReadme(root = projectRoot, check = false) {
  const output = new URL("README.md", root);
  const expected = await renderReadme(root);
  if (check) {
    const actual = await readFile(output, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (actual !== expected)
      throw new Error(
        "README.md is stale. Run pnpm generate:readme and commit the result."
      );
  } else {
    await writeFile(output, expected);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: { check: { type: "boolean", default: false } },
  });
  await generateReadme(projectRoot, values.check);
}
