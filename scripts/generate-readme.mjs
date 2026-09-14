import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Handlebars from "handlebars";
import { format, resolveConfig } from "prettier";

import { pageLedger, locatorLedger } from "../compatibility/api.ts";

const projectRoot = new URL("../", import.meta.url);

function rowsFor(ledger) {
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
      return {
        name,
        status:
          entry.status === "implemented"
            ? partial
              ? "⚠️"
              : "✅"
            : excluded
              ? "🚫"
              : "❌",
        note: (partial || excluded ? entry.limitations : "")
          .replaceAll("|", "&#124;")
          .replace(/\r?\n/g, "<br>"),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function renderReadme(root = projectRoot) {
  const filepath = fileURLToPath(new URL("README.md", root));
  const [template, packageJson, options] = await Promise.all([
    readFile(new URL("README.hbs", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    resolveConfig(filepath),
  ]);
  const pkg = JSON.parse(packageJson);
  const markdown = Handlebars.compile(template, { strict: true })({
    version: pkg.version,
    playwrightVersion: pkg.devDependencies["@playwright/test"],
    tables: [
      { name: "Page", rows: rowsFor(pageLedger) },
      { name: "Locator", rows: rowsFor(locatorLedger) },
    ],
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
