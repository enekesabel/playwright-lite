import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { generateReadme, renderReadme } from "./generate-readme.mjs";
import {
  pageLedger,
  locatorLedger,
  locatorAssertionLedger,
  pageAssertionLedger,
} from "../compatibility/api.ts";

const root = new URL("../", import.meta.url);

test("README renders API compatibility without repeating runtime boundaries", async () => {
  const readme = await renderReadme(root);
  const rows = readme.split("\n").filter((line) => line.startsWith("|"));
  const row = (name) => rows.find((line) => line.includes(`\`${name}\``));

  assert.match(row("getByRole"), /\|\s*✅\s*\|\s*\|$/u);
  assert.match(row("ariaSnapshot"), /\|\s*✅\s*\|\s*\|$/u);
  assert.match(row("goto"), /\|\s*⚠️\s*\|.+/u);
  assert.match(row("mouse"), /\|\s*❌\s*\|\s*\|$/u);
  assert.match(row("close"), /\|\s*❌\s*\|\s*\|$/u);
  assert.match(row("frame"), /\|\s*🚫\s*\|.+/u);
  assert.match(row("[Symbol.asyncDispose]()"), /\|\s*❌\s*\|\s*\|$/u);
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, [
    "Assertions",
    "Use cases",
    "Installation",
    "Runtime boundaries",
    "Compatibility",
    "License",
  ]);
  assert.ok(
    readme.indexOf("### Locator") <
      readme.indexOf("### ElementHandle and JSHandle")
  );
  assert.ok(
    readme.indexOf("### ElementHandle and JSHandle") <
      readme.indexOf("## License")
  );
  assert.doesNotMatch(readme, /\[\^element-handle\]/);
  assert.match(
    readme,
    /const page = createPage\(\{[\s\S]*testIdAttribute: "data-test"/
  );
  assert.doesNotMatch(readme, /`createPage\(\)` accepts/);
  assert.equal(readme, await readFile(new URL("README.md", root), "utf8"));
});

test("README links documented APIs, including selector aliases, without inventing anchors", async () => {
  const readme = await renderReadme(root);
  for (const [name, target] of [
    ["click", "class-page#page-click"],
    ["getByRole", "class-page#page-get-by-role"],
    ["setExtraHTTPHeaders", "class-page#page-set-extra-http-headers"],
    ["keyboard", "class-page#page-keyboard"],
    ["toString", "class-locator#locator-to-string"],
    ["$", "class-page#page-query-selector"],
    ["$$", "class-page#page-query-selector-all"],
    ["$eval", "class-page#page-eval-on-selector"],
    ["$$eval", "class-page#page-eval-on-selector-all"],
    ["setInputFiles", "class-locator#locator-set-input-files"],
  ]) {
    assert.ok(
      readme.includes(
        `[\`${name}\`](https://playwright.dev/docs/api/${target})`
      ),
      target
    );
  }
  assert.doesNotMatch(readme, /Keep contributor instructions|{{!--/);
  for (const name of [
    "addListener",
    "off",
    "on",
    "once",
    "prependListener",
    "removeListener",
  ]) {
    assert.ok(
      readme.includes(`[\`${name}\`](https://playwright.dev/docs/events)`),
      name
    );
  }
  assert.ok(
    readme.includes(
      "[\`[Symbol.asyncDispose]()\`](https://playwright.dev/docs/release-notes#version-160)"
    )
  );
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
    const names = [...section.matchAll(/^\|\s*\[?`([^`]+)`/gm)].map(
      (match) => match[1]
    );
    const expected = Reflect.ownKeys(ledger)
      .map((key) =>
        key === Symbol.asyncDispose ? "[Symbol.asyncDispose]()" : String(key)
      )
      .sort();
    assert.deepEqual(names, expected, `${name} members`);
  }
});

test("README lists every assertion once under Expect, in order", async () => {
  const readme = await renderReadme(root);
  const expectSection = readme.split("### Expect\n")[1].split(/\n### /)[0];
  const headings = [...expectSection.matchAll(/^#### (.+)$/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(headings, [
    "Locator assertions",
    "Page assertions",
    "Generic expect",
  ]);
  for (const [name, ledger] of [
    ["Locator assertions", locatorAssertionLedger],
    ["Page assertions", pageAssertionLedger],
  ]) {
    const table = expectSection.split(`#### ${name}\n`)[1].split(/\n#### /)[0];
    const names = [...table.matchAll(/^\|\s*\[`([^`]+)`/gm)].map(
      (match) => match[1]
    );
    assert.deepEqual(names, Object.keys(ledger).sort(), name);
  }
  assert.match(expectSection, /^\| API response assertions\s*\|\s*🚫/m);
  // The matcher list appears once, in the Locator assertions table.
  assert.equal(readme.match(/`toHaveAccessibleErrorMessage`/g).length, 1);
});

test("event-emitter rows stay one line and link the Events table", async () => {
  const readme = await renderReadme(root);
  const rows = readme.split("\n").filter((line) => line.startsWith("|"));
  for (const name of ["on", "once", "addListener", "prependListener"]) {
    const row = rows.find((line) => line.includes(`[\`${name}\`]`));
    assert.match(row, /\[supported events\]\(#events\)/, name);
  }
  assert.match(
    readme,
    /\[`requestfinished`\]\(https:\/\/playwright\.dev\/docs\/api\/class-page#page-event-request-finished\)/
  );
});

test("Edge cases folds keep their Markdown content renderable", async () => {
  const readme = await renderReadme(root);
  const folds = readme.split("<details>").slice(1);
  assert.ok(folds.length >= 5);
  for (const fold of folds) {
    // GitHub renders Markdown inside <details> only after a blank line.
    assert.match(fold, /^\n<summary>Edge cases<\/summary>\n\n- /);
    assert.match(fold, /\n\n<\/details>\n/);
  }
  assert.doesNotMatch(readme, /\*\*Not available:\*\* none/);
});

test("generation is repeatable and check mode rejects drift without writing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "playwright-lite-readme-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = pathToFileURL(`${directory}/`);
  for (const name of ["package.json", ".prettierrc"])
    await copyFile(new URL(name, root), new URL(name, fixture));
  await mkdir(new URL("docs", fixture));
  await copyFile(
    new URL("docs/readme-template.hbs", root),
    new URL("docs/readme-template.hbs", fixture)
  );
  const output = new URL("README.md", fixture);
  await assert.rejects(generateReadme(fixture, true), /README.md is stale/);
  await assert.rejects(readFile(output), { code: "ENOENT" });

  await generateReadme(fixture);
  const first = await readFile(output, "utf8");
  await generateReadme(fixture);
  assert.equal(await readFile(output, "utf8"), first);
  await generateReadme(fixture, true);

  const template = new URL("docs/readme-template.hbs", fixture);
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
