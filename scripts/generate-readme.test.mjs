import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { renderReadme } from "./generate-readme.mjs";

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
