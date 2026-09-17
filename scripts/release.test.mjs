import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
);
const releasePlease = workflow.jobs["release-please"];
const check = workflow.jobs.check;
const consumer = workflow.jobs["consumer-node20"];
const publish = workflow.jobs["publish-npm"];
const checkout = check.steps.find((step) =>
  step.uses?.startsWith("actions/checkout@")
);
const command = publish.steps.find((step) => step.id === "publish").run;

function runPublish(t, { version = "0.2.0", ...overrides } = {}) {
  const root = mkdtempSync(join(tmpdir(), "playwright-lite-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const packages = join(root, "package");
  const bin = join(root, "bin");
  const calls = join(root, "npm-call.json");
  for (const directory of [join(source, "package"), packages, bin]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(
    join(source, "package/package.json"),
    JSON.stringify({
      name: "@enekesabel/playwright-lite",
      version,
      ...overrides.package,
    })
  );
  const tarball = join(packages, "package.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", source, "package"]);
  if (overrides.artifacts === 0) rmSync(tarball);
  if (overrides.artifacts === 2) {
    writeFileSync(join(packages, "extra.tgz"), readFileSync(tarball));
  }
  writeFileSync(
    join(bin, "npm"),
    '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.NPM_CALL, JSON.stringify(process.argv.slice(2)));\n',
    { mode: 0o755 }
  );
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "-c", command],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: root,
        NPM_CALL: calls,
        RELEASE_VERSION: version,
        ...overrides.env,
      },
      encoding: "utf8",
    }
  );
  return {
    ...result,
    tarball,
    args: existsSync(calls) ? JSON.parse(readFileSync(calls, "utf8")) : null,
  };
}

test("publication is main-only and uses the tested release artifact", () => {
  assert.equal(
    releasePlease.if,
    "github.event_name == 'push' && github.ref == 'refs/heads/main'"
  );
  assert.deepEqual(publish.needs, [
    "release-please",
    "check",
    "corpus",
    "consumer-node20",
  ]);
  assert.equal(
    publish.if,
    "needs.release-please.outputs.release_created == 'true'"
  );
  assert.equal(check.if, "${{ !cancelled() }}");
  assert.equal(
    checkout.with.ref,
    "${{ needs.release-please.outputs.sha || github.sha }}"
  );
  assert.equal(
    consumer.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      .with.ref,
    "${{ needs.check.outputs.sha }}"
  );
  assert.equal(consumer.name, "Packed consumer on Node 20.0.0");
  assert.equal(consumer.strategy, undefined);
  assert.equal(
    consumer.steps.filter((step) =>
      step.uses?.startsWith("actions/download-artifact@")
    ).length,
    1
  );
  assert.deepEqual(
    consumer.steps
      .filter((step) => step.run?.includes("scripts/packed-consumer.mjs"))
      .map((step) => [step.env.PLAYWRIGHT_VERSION, step.run]),
    [
      [
        "1.29.1",
        'node scripts/packed-consumer.mjs "$RUNNER_TEMP/package/"*.tgz',
      ],
      [
        "1.62.1",
        'node scripts/packed-consumer.mjs "$RUNNER_TEMP/package/"*.tgz',
      ],
    ]
  );
  const chromiumInstall = consumer.steps.find((step) =>
    step.run?.includes("playwright@1.62.1 install --with-deps chromium")
  );
  assert.ok(chromiumInstall);
  assert.equal(chromiumInstall.env, undefined);
  assert.equal(publish.steps[1].with.name, "package");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(publish.permissions, {
    contents: "read",
    "id-token": "write",
  });
  const publishRuntime = publish.steps.find((step) =>
    step.uses?.startsWith("actions/setup-node@")
  );
  assert.equal(publishRuntime.with["node-version"], "24.12.0");
  assert.equal(
    publishRuntime.with["registry-url"],
    "https://registry.npmjs.org"
  );
  const publishStep = publish.steps.find((step) => step.id === "publish");
  assert.equal(publishStep.env.NODE_AUTH_TOKEN, undefined);
  assert.equal(publishStep.env.NPM_TOKEN, undefined);
  assert.doesNotMatch(command, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.equal(
    workflow.concurrency["cancel-in-progress"],
    "${{ github.event_name == 'pull_request' }}"
  );
});

test("0.x uses alpha and 1.0+ uses latest without rebuilding the tarball", (t) => {
  for (const [version, tag] of [
    ["0.1.0", "alpha"],
    ["0.9.12", "alpha"],
    ["1.0.0", "latest"],
    ["12.3.4", "latest"],
  ]) {
    const result = runPublish(t, { version });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.args, [
      "publish",
      result.tarball,
      "--registry",
      "https://registry.npmjs.org",
      "--access",
      "public",
      "--tag",
      tag,
      "--ignore-scripts",
    ]);
  }
});

test("unsafe publication inputs fail before invoking npm", (t) => {
  for (const options of [
    { env: { RELEASE_VERSION: "0.3.0" } },
    { package: { name: "@other/package" } },
    { version: "1.0.0-alpha.1" },
    { version: "01.2.3" },
    { artifacts: 0 },
    { artifacts: 2 },
  ]) {
    const result = runPublish(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(result.args, null, "npm must not run on rejected input");
  }
});
