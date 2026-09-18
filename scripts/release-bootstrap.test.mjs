import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync(
    new URL("../release-please-config.json", import.meta.url),
    "utf8"
  )
);
const manifest = JSON.parse(
  readFileSync(
    new URL("../.release-please-manifest.json", import.meta.url),
    "utf8"
  )
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const packageConfig = config.packages["."];

test("bootstrap release configuration stays consistent", () => {
  assert.equal(packageConfig["initial-version"], "0.1.0");
  assert.ok(
    manifest["."] === "0.0.0" || manifest["."] === packageJson.version,
    `expected the manifest to be unreleased or at the package version, got ${manifest["."]}`
  );
  assert.equal(packageConfig.prerelease, true);
  assert.equal(packageConfig["include-component-in-tag"], false);
  assert.match(
    packageJson.version,
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
  );
});

test("release PR titles pass the PR title lint", () => {
  const title = packageConfig["pull-request-title-pattern"].replace(
    "${version}",
    "0.2.2"
  );
  assert.equal(title, "chore(release): 0.2.2");
  execFileSync("pnpm", ["exec", "commitlint"], {
    cwd: new URL("..", import.meta.url),
    input: `${title}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
});
