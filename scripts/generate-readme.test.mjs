import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { generateReadme, renderReadme } from "./generate-readme.mjs";
import { pageLedger, locatorLedger } from "../compatibility/api.ts";

const root = new URL("../", import.meta.url);

test("README renders API compatibility without repeating runtime boundaries", async () => {
  const readme = await renderReadme(root);
  const rows = readme.split("\n").filter((line) => line.startsWith("|"));
  const row = (name) => rows.find((line) => line.includes(`\`${name}\``));

  assert.match(row("getByRole"), /\|\s*✅\s*\|\s*\|$/u);
  assert.match(row("ariaSnapshot"), /\|\s*✅\s*\|\s*\|$/u);
  assert.match(row("goto"), /\|\s*⚠️\s*\|.+/u);
  assert.match(row("goBack"), /\|\s*❌\s*\|\s*\|$/u);
  assert.match(row("addInitScript"), /\|\s*❌\s*\|\s*\|$/u);
  assert.match(row("frame"), /\|\s*🚫\s*\|.+/u);
  assert.match(row("Symbol.asyncDispose"), /\|\s*❌\s*\|\s*\|$/u);
  assert.ok(
    readme.indexOf("## Installation") < readme.indexOf("## Compatibility")
  );
  assert.ok(readme.indexOf("### Locator") < readme.indexOf("## License"));
  assert.equal(readme, await readFile(new URL("README.md", root), "utf8"));
});

test("README lists every Page and Locator member once, including symbols", async () => {
  const readme = await renderReadme(root);
  for (const [name, ledger] of [
    ["Page", pageLedger],
    ["Locator", locatorLedger],
  ]) {
    const section = readme
      .split(`### ${name}\n`)[1]
      .split(/\n## /)[0]
      .split(/\n### /)[0];
    const names = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map(
      (match) => match[1]
    );
    const expected = Reflect.ownKeys(ledger)
      .map((key) =>
        key === Symbol.asyncDispose ? "Symbol.asyncDispose" : String(key)
      )
      .sort();
    assert.deepEqual(names, expected, `${name} members`);
  }
});

test("generation is repeatable and check mode rejects drift without writing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "playwright-lite-readme-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = pathToFileURL(`${directory}/`);
  for (const name of ["README.hbs", "package.json", ".prettierrc"])
    await copyFile(new URL(name, root), new URL(name, fixture));
  const output = new URL("README.md", fixture);
  await assert.rejects(generateReadme(fixture, true), /README.md is stale/);
  await assert.rejects(readFile(output), { code: "ENOENT" });

  await generateReadme(fixture);
  const first = await readFile(output, "utf8");
  await generateReadme(fixture);
  assert.equal(await readFile(output, "utf8"), first);
  await generateReadme(fixture, true);

  const template = new URL("README.hbs", fixture);
  await writeFile(
    template,
    (await readFile(template, "utf8")) + "\nTemplate edit.\n"
  );
  const metadata = new URL("package.json", fixture);
  const pkg = JSON.parse(await readFile(metadata, "utf8"));
  pkg.devDependencies["@playwright/test"] = "9.8.7";
  await writeFile(metadata, JSON.stringify(pkg));
  await assert.rejects(generateReadme(fixture, true), /pnpm generate:readme/);
  assert.equal(await readFile(output, "utf8"), first);
  await generateReadme(fixture);
  const updated = await readFile(output, "utf8");
  assert.match(updated, /Template edit\./);
  assert.match(updated, /Targets Playwright \*\*9\.8\.7\*\*/);

  await writeFile(output, "manual edit\n");
  await assert.rejects(generateReadme(fixture, true), /README.md is stale/);
  assert.equal(await readFile(output, "utf8"), "manual edit\n");
});
