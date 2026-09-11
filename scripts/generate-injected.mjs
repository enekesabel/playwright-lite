import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { corpus } from "../tests/upstream/corpus.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
assert.equal(corpus.source.repository, "microsoft/playwright");
assert.match(corpus.source.commit, /^[a-f0-9]{40}$/);
const temporary = mkdtempSync(resolve(tmpdir(), "playwright-lite-upstream-"));
const checkout = resolve(temporary, "playwright");
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });

function output(path, bytes) {
  const target = resolve(root, path);
  if (check) {
    assert.ok(existsSync(target), `Missing generated file: ${path}`);
    assert.ok(
      readFileSync(target).equals(Buffer.from(bytes)),
      `Generated file differs: ${path}`
    );
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

try {
  run("git", ["init", "--quiet", checkout]);
  run("git", [
    "-C",
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/microsoft/playwright.git",
  ]);
  run("git", [
    "-C",
    checkout,
    "fetch",
    "--quiet",
    "--depth=1",
    "origin",
    corpus.source.commit,
  ]);
  run("git", ["-C", checkout, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.equal(revision, corpus.source.commit);
  const require = createRequire(import.meta.url);
  const modules = resolve(
    dirname(require.resolve("esbuild/package.json")),
    ".."
  );
  run(process.execPath, [resolve(checkout, "utils/generate_injected.js")], {
    cwd: checkout,
    env: {
      ...process.env,
      NODE_PATH: [modules, process.env.NODE_PATH]
        .filter(Boolean)
        .join(delimiter),
    },
  });
  const artifact = readFileSync(
    resolve(
      checkout,
      "packages/playwright-core/src/generated/injectedScriptSource.ts"
    )
  );
  output("build/generated/injectedScriptSource.ts", artifact);
  console.log(
    `InjectedScript: ${artifact.byteLength} bytes, sha256 ${createHash("sha256").update(artifact).digest("hex")}`
  );
  const localLayout = await import(
    pathToFileURL(resolve(root, "src/keyboardLayout.ts"))
  );
  const upstreamLayout = await import(
    pathToFileURL(
      resolve(
        checkout,
        "packages/playwright-core/src/server/usKeyboardLayout.ts"
      )
    )
  );
  assert.deepEqual(
    localLayout.USKeyboardLayout,
    upstreamLayout.USKeyboardLayout,
    "Keyboard layout differs from pinned Playwright"
  );
  assert.equal(localLayout.keypadLocation, upstreamLayout.keypadLocation);
  output(
    "LICENSES/PLAYWRIGHT-LICENSE.txt",
    readFileSync(resolve(checkout, "LICENSE"))
  );
  for (const name of ["NOTICE", "ThirdPartyNotices.txt"]) {
    const source = resolve(checkout, name);
    if (existsSync(source))
      output(`LICENSES/PLAYWRIGHT-${name}`, readFileSync(source));
  }
  const yamlRoot = dirname(require.resolve("yaml/package.json"));
  output(
    "LICENSES/YAML-LICENSE.txt",
    readFileSync(resolve(yamlRoot, "LICENSE"))
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
