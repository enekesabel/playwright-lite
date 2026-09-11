import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(resolve(tmpdir(), "playwright-lite-consumer-"));
const env = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" };
let browser;
try {
  assert.ok(
    process.argv.length <= 3,
    "Usage: node scripts/packed-consumer.mjs [package.tgz]"
  );
  let tarball = process.argv[2] && resolve(process.argv[2]);
  if (!tarball) {
    assert.ok(
      existsSync(resolve(root, "dist/index.mjs")),
      "Run pnpm build before the consumer check."
    );
    const [packed] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
        { cwd: root, encoding: "utf8", env }
      )
    );
    tarball = resolve(temporary, packed.filename);
  }
  assert.ok(existsSync(tarball), "Package tarball does not exist.");
  // Keep consumer tools outside the repository so Node compatibility does not depend on development tooling.
  writeFileSync(
    resolve(temporary, "package.json"),
    JSON.stringify(
      {
        name: "standalone-consumer-check",
        private: true,
        type: "module",
        dependencies: {
          "@enekesabel/playwright-lite": `file:${tarball}`,
          "@playwright/test": "1.62.1",
          "@types/node": "20.19.43",
          esbuild: "0.28.1",
          typescript: "6.0.3",
        },
      },
      null,
      2
    )
  );
  execFileSync(
    "npm",
    [
      "install",
      "--engine-strict",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org",
    ],
    { cwd: temporary, stdio: "inherit", env }
  );
  const consumerRequire = createRequire(resolve(temporary, "package.json"));
  const installedRoot = resolve(
    temporary,
    "node_modules/@enekesabel/playwright-lite"
  );
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: installedRoot,
      encoding: "utf8",
      env,
    })
  );
  const files = new Set(packed.files.map((file) => file.path));
  for (const file of [
    "dist/index.mjs",
    "dist/index.d.mts",
    "LICENSE",
    "README.md",
    "THIRD_PARTY_NOTICES.txt",
    "LICENSES/PLAYWRIGHT-LICENSE.txt",
    "LICENSES/PLAYWRIGHT-NOTICE",
    "LICENSES/YAML-LICENSE.txt",
  ]) {
    assert.ok(files.has(file), `Missing package file: ${file}`);
  }
  for (const file of files) {
    assert.ok(
      /^(dist\/|LICENSES\/|LICENSE$|README\.md$|THIRD_PARTY_NOTICES\.txt$|package\.json$)/.test(
        file
      ),
      `Unexpected package file: ${file}`
    );
  }
  const installedPackage = JSON.parse(
    readFileSync(resolve(installedRoot, "package.json"), "utf8")
  );
  assert.equal(installedPackage.license, "MIT");
  assert.equal(installedPackage.engines.node, ">=20");
  assert.deepEqual(Object.keys(installedPackage.exports), ["."]);
  assert.equal(installedPackage.dependencies?.yaml, undefined);
  assert.equal(installedPackage.devDependencies.yaml, "2.9.0");
  assert.throws(() => consumerRequire.resolve("yaml"), {
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(
    () => consumerRequire.resolve("@enekesabel/playwright-lite/dom"),
    { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }
  );
  const declarations = readFileSync(
    resolve(installedRoot, "dist/index.d.mts"),
    "utf8"
  );
  assert.doesNotMatch(
    declarations,
    /\b(?:AdapterJSHandle|LOCATOR_BRAND|isPlaywrightLiteLocator|resolveLocatorElements)\b/
  );
  copyFileSync(
    resolve(root, "tests/consumer.ts"),
    resolve(temporary, "consumer.ts")
  );
  writeFileSync(
    resolve(temporary, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2024",
          verbatimModuleSyntax: true,
          types: ["node"],
        },
        include: ["consumer.ts"],
      },
      null,
      2
    )
  );
  execFileSync(
    process.execPath,
    [
      consumerRequire.resolve("typescript/bin/tsc"),
      "--project",
      resolve(temporary, "tsconfig.json"),
    ],
    { cwd: temporary, stdio: "inherit" }
  );
  const { build } = consumerRequire("esbuild");
  const { chromium } = consumerRequire("@playwright/test");
  const bundlePath = resolve(temporary, "consumer.js");
  const result = await build({
    absWorkingDir: temporary,
    entryPoints: ["consumer.ts"],
    outfile: bundlePath,
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "consumer",
    metafile: true,
  });
  assert.ok(
    Object.keys(result.metafile.inputs).some((path) =>
      path.includes("node_modules/@enekesabel/playwright-lite/dist/index.mjs")
    ),
    "Consumer must import the installed artifact."
  );
  for (const output of Object.values(result.metafile.outputs))
    assert.equal(
      output.imports.length,
      0,
      "Browser bundle must be self-contained."
    );
  browser = await chromium.launch({ headless: true });
  const driver = await browser.newPage();
  await driver.setContent(
    '<label>Name<input data-test="name"></label><button>Save</button><output></output><span data-testid="default">Default</span>'
  );
  await driver.addScriptTag({ path: bundlePath });
  const observed = await driver.evaluate(() => window.consumer.runConsumer());
  assert.deepEqual(observed.exports, ["createPage"]);
  assert.equal(observed.value, "Ada!");
  assert.equal(observed.saved, "Ada!");
  assert.equal(observed.clicks, 1);
  assert.equal(observed.trustedClick, false);
  assert.equal(observed.defaultCount, 1);
  assert.match(observed.snapshot, /button "Save"/);
  assert.match(observed.locatorSnapshot, /button "Save"/);
  console.log(
    `PASS packed consumer on Node ${process.version}: strict isolated install, minimal exports, declarations, POM actions, keyboard, test IDs, and snapshots without an installed YAML dependency`
  );
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
