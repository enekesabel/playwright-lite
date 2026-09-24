import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
);
const { changes, "corpus-shard": corpusShard, corpus } = workflow.jobs;
const gate = workflow.jobs["ci-ok"];
const corpusStep = changes.steps.find((step) => step.id === "corpus");
const gateStep = gate.steps[0];

function bash(t, command, { cwd, env }) {
  const root = mkdtempSync(join(tmpdir(), "playwright-lite-ci-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "output");
  writeFileSync(output, "");
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "-c", command],
    {
      cwd: cwd ?? root,
      env: { ...process.env, GITHUB_OUTPUT: output, ...env },
      encoding: "utf8",
    }
  );
  return { ...result, output: readFileSync(output, "utf8") };
}

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(repo, path, content = "base") {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), `${content}\n`);
}

// A PR checkout: a base commit, then the PR's merge commit on top of it.
function decideCorpus(t, change) {
  const repo = mkdtempSync(join(tmpdir(), "playwright-lite-pr-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "--quiet");
  git(repo, "config", "user.email", "ci@example.com");
  git(repo, "config", "user.name", "CI");
  for (const path of ["src/page.ts", "docs/guide.md", "README.md"]) {
    write(repo, path);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "base");
  change(repo);
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "pr");
  const result = bash(t, corpusStep.run, {
    cwd: repo,
    env: { EVENT_NAME: "pull_request" },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.output;
}

function edits(...paths) {
  return (repo) => paths.forEach((path) => write(repo, path, "changed"));
}

test("a PR touching only skip-listed paths skips the corpus", (t) => {
  for (const paths of [
    ["docs/guide.md", "README.md"],
    ["AGENTS.md", "CHANGELOG.md", "LICENSES/playwright.txt"],
    ["tests/contract/on.test.ts", "src/page.test.ts"],
    ["src/nested/dialog.test.ts", ".claude/settings.json"],
    [
      "commitlint.config.js",
      "release-please-config.json",
      ".release-please-manifest.json",
    ],
  ]) {
    assert.equal(decideCorpus(t, edits(...paths)), "corpus=false\n", paths);
  }
});

test("a PR touching any other path runs the corpus", (t) => {
  for (const paths of [
    ["src/page.ts"],
    ["docs/guide.md", "compatibility/api.ts"],
    ["tests/upstream/baseline.json"],
    ["tests/assets/input/button.html"],
    ["scripts/upstream-baseline.mjs"],
    [".github/workflows/ci.yml"],
    ["package.json"],
    ["pnpm-lock.yaml"],
    ["playwright.config.ts"],
    ["src/page.test.tsx"],
    ["docsx/new-input.ts"],
    ["unlisted-new-file.ts"],
  ]) {
    assert.equal(decideCorpus(t, edits(...paths)), "corpus=true\n", paths);
  }
});

test("moving a corpus input to a skip-listed path runs the corpus", (t) => {
  const output = decideCorpus(t, (repo) =>
    git(repo, "mv", "src/page.ts", "docs/page.ts")
  );
  assert.equal(output, "corpus=true\n");
});

test("deleting a corpus input runs the corpus", (t) => {
  const output = decideCorpus(t, (repo) => git(repo, "rm", "src/page.ts"));
  assert.equal(output, "corpus=true\n");
});

test("a PR with no file changes runs the corpus", (t) => {
  assert.equal(
    decideCorpus(t, () => {}),
    "corpus=true\n"
  );
});

test("a PR whose base cannot be read fails instead of skipping", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "playwright-lite-pr-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "--quiet");
  git(repo, "config", "user.email", "ci@example.com");
  git(repo, "config", "user.name", "CI");
  write(repo, "docs/guide.md");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "only commit");
  const result = bash(t, corpusStep.run, {
    cwd: repo,
    env: { EVENT_NAME: "pull_request" },
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

test("pushes and manual runs always run the corpus", (t) => {
  for (const event of ["push", "workflow_dispatch"]) {
    const result = bash(t, corpusStep.run, { env: { EVENT_NAME: event } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "corpus=true\n");
  }
  const checkout = changes.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@")
  );
  assert.equal(checkout.if, "github.event_name == 'pull_request'");
  assert.equal(checkout.with["fetch-depth"], 2);
});

test("both corpus jobs run exactly when the changes job says so", () => {
  for (const job of [corpusShard, corpus]) {
    assert.ok(job.needs.includes("changes"));
    assert.equal(
      job.if,
      "${{ !cancelled() && needs.changes.outputs.corpus == 'true' }}"
    );
  }
});

test("the gate needs every job a PR must pass and always runs", () => {
  assert.equal(gate.name, "CI OK");
  assert.equal(gate.if, "${{ always() }}");
  assert.deepEqual(
    [...gate.needs].sort(),
    Object.keys(workflow.jobs)
      .filter(
        (job) => !["release-please", "publish-npm", "ci-ok"].includes(job)
      )
      .sort()
  );
  assert.equal(gateStep.env.NEEDS, "${{ toJSON(needs) }}");
});

function runGate(t, results, decision = "true") {
  const needs = Object.fromEntries(
    gate.needs.map((job) => [job, { result: "success", outputs: {} }])
  );
  needs.changes.outputs.corpus = decision;
  for (const [job, result] of Object.entries(results)) {
    needs[job].result = result;
  }
  return bash(t, gateStep.run, { env: { NEEDS: JSON.stringify(needs) } });
}

test("the gate passes when every job succeeded", (t) => {
  assert.equal(runGate(t, {}).status, 0);
});

test("the gate passes a corpus the changes job skipped", (t) => {
  const result = runGate(
    t,
    { "corpus-shard": "skipped", corpus: "skipped" },
    "false"
  );
  assert.equal(result.status, 0, result.stdout);
});

test("the gate fails a skipped corpus the changes job asked for", (t) => {
  const result = runGate(t, { "corpus-shard": "skipped", corpus: "skipped" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /::error::corpus-shard: skipped/);
  assert.match(result.stdout, /::error::corpus: skipped/);
});

test("the gate fails any job that did not succeed", (t) => {
  for (const job of gate.needs) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      // A corpus job the changes job skipped is covered above.
      const run = runGate(t, { [job]: result }, "false");
      const allowed =
        result === "skipped" && ["corpus-shard", "corpus"].includes(job);
      assert.equal(run.status === 0, allowed, `${job}: ${result}`);
      if (!allowed) assert.match(run.stdout, new RegExp(`::error::${job}:`));
    }
  }
});
