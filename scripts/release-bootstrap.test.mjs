import assert from "node:assert/strict";
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

function npmTag(version) {
  return version.startsWith("0.") ? "alpha" : "latest";
}

test("bootstrap release configuration stays in the alpha era", () => {
  assert.equal(packageConfig["initial-version"], "0.1.0");
  assert.equal(packageJson.version, packageConfig["initial-version"]);
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
  assert.equal(npmTag(packageJson.version), "alpha");
  assert.equal(npmTag("1.0.0"), "latest");
});
