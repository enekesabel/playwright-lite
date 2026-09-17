#!/usr/bin/env node
/**
 * Manages the upstream compatibility baseline.
 *
 * Commands:
 *   check   verify corpus integrity → run tests → gate against baseline
 *   promote <test-id> <method> <evidence>  rerun corpus and promote a reviewed test
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { corpus, specNames } from "../tests/upstream/corpus.ts";
import { stableTestId } from "../tests/upstream/stableTestId.ts";
import { statusFor } from "../compatibility/api.ts";
import { verifyIntegrity } from "./upstream-specs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const REPORT_PATH = resolve(PKG_ROOT, "test-results/report.json");
// The sabotage rerun gets its own directory: a Playwright run clears the output
// directory it writes to, and the corpus report and diagnostics of this
// promotion must survive the rerun. Its generated config sits beside that
// output directory rather than inside it, for the same reason.
const SABOTAGE_DIR = resolve(PKG_ROOT, "test-results/sabotage");
const SABOTAGE_OUTPUT_DIR = resolve(SABOTAGE_DIR, "output");
const SABOTAGE_CONFIG_PATH = resolve(SABOTAGE_DIR, "playwright.config.ts");
const SABOTAGE_REPORT_PATH = resolve(SABOTAGE_DIR, "report.json");
const BASELINE_PATH = resolve(PKG_ROOT, "tests/upstream/baseline.json");

// ── Report parsing ──────────────────────────────────────────────────

/**
 * Parse a Playwright JSON report into a flat list of test entries.
 * Each entry: { id, status, file }
 *
 * Stable ID: "specFilename > full test title"
 */
export function parseReport(report) {
  const entries = [];

  function walkSuite(suite, titlePath) {
    for (const child of suite.suites ?? []) {
      walkSuite(child, [...titlePath, child.title]);
    }
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = test.results?.[0];
        if (!result) continue;

        const file = spec.file ?? suite.file ?? "";
        const filename = file.split("/").pop() ?? file;

        entries.push({
          id: stableTestId(file, [...titlePath, spec.title]),
          status: result.status,
          file: filename,
          error: result.error?.message ?? result.errors?.[0]?.message ?? null,
          execution: JSON.parse(
            (test.annotations ?? []).find((a) => a.type === "adapter-execution")
              ?.description ?? "null"
          ),
        });
      }
    }
  }

  for (const suite of report.suites ?? []) {
    walkSuite(suite, []);
  }

  return entries;
}

// ── Report-level error validation ────────────────────────────────────

/**
 * Reject reports with non-empty top-level `errors` (collection/runner
 * failures that prevent trustworthy results).
 * Returns an array of error message strings (empty = OK).
 */
export function validateReportErrors(report) {
  const errors = report.errors ?? [];
  return errors.map(
    (e) => e.message?.split("\n")[0] ?? "unknown collection error"
  );
}

// ── Completeness validation ─────────────────────────────────────────

/**
 * Validate that the report covers every corpus spec, IDs are unique,
 * and counts match.
 *
 * @param {Array} entries  Parsed test entries.
 * @param {readonly string[]} names  Corpus spec filenames.
 */
export function validateCompleteness(entries, names) {
  const corpusSpecs = new Set(names);
  const corpusEntries = entries.filter((e) => corpusSpecs.has(e.file));
  const errors = [];

  // Every corpus spec must appear
  const presentSpecs = new Set(corpusEntries.map((e) => e.file));
  for (const spec of corpusSpecs) {
    if (!presentSpecs.has(spec)) {
      errors.push(`Missing corpus spec in report: ${spec}`);
    }
  }

  // Stable IDs must be unique
  const ids = corpusEntries.map((e) => e.id);
  const idSet = new Set(ids);
  if (ids.length !== idSet.size) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    errors.push(`Duplicate stable IDs: ${[...new Set(dupes)].join(", ")}`);
  }

  return {
    errors,
    specCount: presentSpecs.size,
    testCount: corpusEntries.length,
  };
}

// ── Comparison ──────────────────────────────────────────────────────

/**
 * Compare current results against a recorded baseline.
 *
 * @param {Array} entries  Parsed test entries.
 * @param {{ reviewed: Array<{id: string, method: string, evidence: string}> }} baseline Recorded baseline.
 * @param {readonly string[]} names  Corpus spec filenames.
 */
export function compareBaseline(entries, baseline, names) {
  const baselineSet = new Set(baseline.reviewed.map((entry) => entry.id));
  const corpusSpecs = new Set(names);
  const corpusEntries = entries.filter((e) => corpusSpecs.has(e.file));

  const passed = corpusEntries.filter((e) => isCandidate(e));

  const skipped = corpusEntries.filter((e) => e.status === "skipped");
  const failed = corpusEntries.filter(
    (e) => e.status !== "passed" && e.status !== "skipped"
  );

  const regressions = baseline.reviewed
    .filter(
      (review) =>
        !passed.some(
          (entry) =>
            entry.id === review.id &&
            certifiesBrowserMethod(entry, review.method)
        )
    )
    .map((review) => review.id);
  const newlyPassing = passed
    .filter((e) => !baselineSet.has(e.id))
    .map((e) => e.id);

  return {
    regressions: regressions.sort(),
    newlyPassing: newlyPassing.sort(),
    baselinePassing: baselineSet.size,
    currentPassing: passed.map((e) => e.id).sort(),
    failed: failed.length,
    skipped: skipped.length,
    diagnosticPassed: corpusEntries.filter(
      (e) => e.status === "passed" && !isCandidate(e)
    ).length,
    total: corpusEntries.length,
  };
}

export function isCandidate(entry) {
  return (
    entry.status === "passed" &&
    entry.execution?.entered?.length > 0 &&
    entry.execution?.failures?.length === 0
  );
}

function isOutOfScopeMethod(method) {
  const [owner, member] = method.split(".", 2);
  if (owner !== "Page" && owner !== "Locator") return false;
  return statusFor(owner, member) === "out-of-scope";
}

function certifiesBrowserMethod(entry, method) {
  return (
    !isOutOfScopeMethod(method) &&
    entry.execution.entered.includes(method) &&
    !entry.execution.native?.includes(method)
  );
}

export function reviewedPromotion(entries, id, method, evidence) {
  const entry = entries.find((entry) => entry.id === id);
  if (isOutOfScopeMethod(method))
    throw new Error(
      `${method} is out of scope and cannot be promoted as browser compatibility evidence.`
    );
  if (entry?.execution?.native?.includes(method))
    throw new Error(
      `${method} was executed natively and cannot be promoted as browser compatibility evidence.`
    );
  if (
    !entry ||
    !isCandidate(entry) ||
    !entry.execution.entered.includes(method)
  )
    throw new Error(
      "Promotion requires a passing test with matching adapter execution and no recorded transport/dispatch failures."
    );
  if (!evidence?.trim())
    throw new Error("Explain what the reviewed assertion proves.");
  return { id, method, evidence: evidence.trim() };
}

/**
 * Verdict of the sabotage rerun: the same test re-run with the reviewed
 * method's in-browser dispatch throwing instead of executing. A test that
 * still passes is vacuous about that method, whatever the recorded evidence
 * says.
 *
 * @param {Array} entries  Parsed entries of the sabotaged rerun.
 */
export function sabotageVerdict(entries, id, method) {
  const entry = entries.find((entry) => entry.id === id);
  if (!entry)
    throw new Error(
      `The rerun with ${method} sabotaged did not run ${id}; promotion needs that observation.`
    );
  if (entry.status === "skipped")
    throw new Error(
      `The rerun with ${method} sabotaged skipped ${id}, so it observed nothing.`
    );
  if (entry.status === "passed")
    throw new Error(
      `${id} still passes with ${method} sabotaged, so it does not prove ${method}.`
    );
}

// ── Clustering ──────────────────────────────────────────────────────

// Diagnostic categories describe the observed failure, not whether a call
// was setup or the test subject. That distinction still requires test review.
export function failurePhase(entry) {
  const error = entry.error ?? "";
  if (entry.status === "passed" || entry.status === "skipped")
    return entry.status;
  if (
    /cannot serialize (?:function|argument)|nested function arguments|event callbacks|handles, frames, or non-plain object arguments/i.test(
      error
    )
  )
    return "argument transport";
  if (/well-serializable/i.test(error)) return "callback reconstruction";
  if (/serializ/i.test(error)) return "serialization failure";
  if (/is not a function|is not defined/.test(error))
    return "missing member or reference";
  if (/can be only used with Locator object/.test(error))
    return "matcher integration";
  if (/expect\(/.test(error)) return "assertion";
  if (entry.status === "timedOut" || /timeout|timed out/i.test(error))
    return "timeout";
  return entry.execution?.entered?.length
    ? "after adapter entry"
    : "before adapter entry";
}

function clusterFailures(entries, corpusSpecs) {
  const failures = entries.filter(
    (e) =>
      corpusSpecs.has(e.file) && e.status !== "passed" && e.status !== "skipped"
  );
  const byFile = new Map();
  for (const e of failures) {
    const phase = failurePhase(e);
    byFile.set(phase, (byFile.get(phase) ?? 0) + 1);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => `  ${file}: ${count} failures`);
}

// ── Corpus integrity ────────────────────────────────────────────────

/**
 * Verify corpus integrity (spec file hashes).
 * Exits with the given code on failure.
 */
function requireCorpusIntegrity(exitCode) {
  console.log("Verifying corpus integrity…");
  const { drifted, missing } = verifyIntegrity();
  if (drifted > 0 || missing > 0) {
    console.error(
      `\nERROR: Corpus integrity check failed (${drifted} drifted, ${missing} missing).`
    );
    console.error("Run `upstream:sync` to refresh spec files.");
    process.exit(exitCode);
  }
  console.log("Corpus integrity verified.\n");
}

// ── Corpus runner ───────────────────────────────────────────────────

function resolvePlaywrightCli() {
  const req = createRequire(resolve(PKG_ROOT, "package.json"));
  return req.resolve("@playwright/test/cli");
}

/**
 * Run selected specs and require a JSON report.  Tolerates Playwright's
 * ordinary test-failure exit (code 1) but fails on spawn errors, signals
 * and missing reports.  Returns the Playwright exit code.
 */
function runPlaywright(selectionArgs, reportPath) {
  const args = [
    resolvePlaywrightCli(),
    "test",
    "--reporter=list,json",
    "--timeout=15000",
    ...selectionArgs,
  ];

  // Delete old report so we can detect generation failure.
  if (existsSync(reportPath)) unlinkSync(reportPath);

  let exitCode;
  try {
    execFileSync(process.execPath, args, {
      cwd: PKG_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      },
    });
    exitCode = 0;
  } catch (err) {
    if (err.status != null) {
      exitCode = err.status;
    } else {
      console.error("ERROR: Playwright process failed to start or was killed.");
      if (err.signal) console.error(`Signal: ${err.signal}`);
      process.exit(2);
    }
  }

  // Only 0 (all passed) and 1 (some tests failed) are expected.
  if (exitCode !== 0 && exitCode !== 1) {
    console.error(
      `ERROR: Playwright exited with unexpected status ${exitCode} (runner/config failure).`
    );
    process.exit(2);
  }

  // Validate report was created
  if (!existsSync(reportPath)) {
    console.error(
      `ERROR: Report not generated at ${reportPath} (exit code ${exitCode}).`
    );
    process.exit(2);
  }

  return exitCode;
}

/**
 * Run the corpus and validate that the report covers it completely.
 */
function runCorpus() {
  const exitCode = runPlaywright(
    specNames.map((s) => `tests/upstream/${s}`),
    REPORT_PATH
  );

  const report = loadAndValidateReport(REPORT_PATH, 2);
  writeFileSync(
    resolve(PKG_ROOT, "test-results/compatibility.json"),
    JSON.stringify(
      report.entries.map((entry) => ({ ...entry, phase: failurePhase(entry) })),
      null,
      2
    ) + "\n"
  );

  console.log(
    `Corpus: ${report.specCount} specs, ${report.testCount} tests (Playwright exit ${exitCode})`
  );
  return report.entries;
}

/**
 * Write the configuration the sabotage rerun runs with: the package
 * configuration, with the withheld method as a literal in its `use` block.
 * Workers re-evaluate this file, so the method never travels through the
 * environment, where a spec could set it.
 */
function writeSabotageConfig(method) {
  mkdirSync(SABOTAGE_DIR, { recursive: true });
  writeFileSync(
    SABOTAGE_CONFIG_PATH,
    [
      "// Generated by scripts/upstream-baseline.mjs for one promotion rerun.",
      `import config from ${JSON.stringify(resolve(PKG_ROOT, "playwright.config.ts"))};`,
      "",
      "export default {",
      "  ...config,",
      // testDir and outputDir resolve against this file's directory.
      `  testDir: ${JSON.stringify(resolve(PKG_ROOT, "tests/upstream"))},`,
      `  outputDir: ${JSON.stringify(SABOTAGE_OUTPUT_DIR)},`,
      `  use: { ...config.use, sabotagedMethod: ${JSON.stringify(method)} },`,
      "};",
    ].join("\n") + "\n"
  );
}

/**
 * Rerun a single corpus test with the reviewed method sabotaged: the fixture
 * makes the in-browser adapter dispatch for that method throw instead of
 * executing it.
 */
function runSabotaged(id, method) {
  const [file, ...titles] = id.split(" > ");
  console.log(`\nRerunning ${id} with ${method} sabotaged…`);
  writeSabotageConfig(method);
  runPlaywright(
    [
      `--config=${SABOTAGE_CONFIG_PATH}`,
      resolve(PKG_ROOT, `tests/upstream/${file}`),
      "--grep",
      titles.join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ],
    SABOTAGE_REPORT_PATH
  );
  const raw = JSON.parse(readFileSync(SABOTAGE_REPORT_PATH, "utf8"));
  const reportErrors = validateReportErrors(raw);
  if (reportErrors.length > 0) {
    console.error("ERROR: Sabotage rerun report contains runner errors:");
    for (const e of reportErrors) console.error(`  ${e}`);
    process.exit(2);
  }
  return parseReport(raw);
}

// ── Commands ────────────────────────────────────────────────────────

/**
 * Parse, validate report errors, and validate completeness.
 */
function loadAndValidateReport(path, exitCodeOnFailure) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.error("ERROR: Report is malformed JSON.");
    process.exit(exitCodeOnFailure);
  }

  // Reject collection/runner errors
  const reportErrors = validateReportErrors(raw);
  if (reportErrors.length > 0) {
    console.error("ERROR: Report contains collection/runner errors:");
    for (const e of reportErrors) console.error(`  ${e}`);
    process.exit(exitCodeOnFailure);
  }

  const entries = parseReport(raw);
  const { errors, specCount, testCount } = validateCompleteness(
    entries,
    specNames
  );
  if (errors.length > 0) {
    console.error("ERROR: Report completeness validation failed:");
    for (const e of errors) console.error(`  ${e}`);
    process.exit(exitCodeOnFailure);
  }

  return { entries, specCount, testCount };
}

function doUpdate(entries) {
  const corpusSpecs = new Set(specNames);
  const corpusEntries = entries.filter((e) => corpusSpecs.has(e.file));

  const args = process.argv.slice(3);
  if (args[0] === "--") args.shift();
  if (!args.length || args.length % 3)
    throw new Error(
      "Provide one or more <test-id> <method> <evidence> triples."
    );
  const promotions = [];
  for (let index = 0; index < args.length; index += 3)
    promotions.push(
      reviewedPromotion(entries, ...args.slice(index, index + 3))
    );
  if (new Set(promotions.map((entry) => entry.id)).size !== promotions.length)
    throw new Error("Each promoted test ID must be unique.");
  const previous = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (compareBaseline(entries, previous, specNames).regressions.length)
    throw new Error(
      "Resolve existing baseline regressions before promoting tests."
    );
  for (const { id, method } of promotions)
    sabotageVerdict(runSabotaged(id, method), id, method);
  const reviewed = [
    ...previous.reviewed.filter(
      (entry) => !promotions.some((p) => p.id === entry.id)
    ),
    ...promotions,
  ].sort((a, b) => a.id.localeCompare(b.id));

  const baseline = {
    source: {
      repository: corpus.source.repository,
      commit: corpus.source.commit,
    },
    selectedTestCount: corpusEntries.length,
    reviewed,
  };

  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(
    `Baseline updated: ${reviewed.length} reviewed, ${corpusEntries.length} selected tests.`
  );
}

function doCheck(entries) {
  if (!existsSync(BASELINE_PATH)) {
    console.error("ERROR: No reviewed baseline found.");
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (
    !Array.isArray(baseline.reviewed) ||
    baseline.reviewed.some(
      (entry) => !entry.id || !entry.method || !entry.evidence?.trim()
    ) ||
    new Set(baseline.reviewed.map((entry) => entry.id)).size !==
      baseline.reviewed.length
  )
    throw new Error(
      "Baseline entries require unique IDs, methods, and review evidence."
    );
  const corpusSpecs = new Set(specNames);

  // Validate baseline provenance matches corpus
  if (
    baseline.source?.repository !== corpus.source.repository ||
    baseline.source?.commit !== corpus.source.commit
  ) {
    console.error("ERROR: Baseline source provenance does not match corpus.");
    console.error(
      `  Baseline: ${baseline.source?.repository}@${baseline.source?.commit}`
    );
    console.error(
      `  Corpus: ${corpus.source.repository}@${corpus.source.commit}`
    );
    process.exit(1);
  }

  // Validate selectedTestCount
  const corpusEntries = entries.filter((e) => corpusSpecs.has(e.file));
  if (
    baseline.selectedTestCount != null &&
    corpusEntries.length !== baseline.selectedTestCount
  ) {
    console.error(
      `ERROR: Selected test count mismatch. Baseline: ${baseline.selectedTestCount}, Report: ${corpusEntries.length}.`
    );
    process.exit(1);
  }

  const result = compareBaseline(entries, baseline, specNames);

  // Reconcile: total = passed + failed + skipped
  const reconciled =
    result.currentPassing.length +
    result.diagnosticPassed +
    result.failed +
    result.skipped;

  console.log("Compatibility baseline check");
  console.log("─".repeat(40));
  console.log(`Corpus: ${result.total} tests`);
  console.log(
    `Candidate passes: ${result.currentPassing.length} (${result.baselinePassing} reviewed baseline)`
  );
  console.log(`Failed: ${result.failed}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(
    `Diagnostic passes without execution evidence: ${result.diagnosticPassed}`
  );
  console.log(`Reconciled: ${reconciled} / ${result.total}`);
  console.log(`Newly passing: ${result.newlyPassing.length}`);
  console.log(`Regressions: ${result.regressions.length}`);

  const clusters = clusterFailures(entries, corpusSpecs);
  if (clusters.length > 0) {
    console.log("\nFailure clusters:");
    for (const line of clusters) console.log(line);
  }

  if (result.newlyPassing.length > 0) {
    console.log(
      "\nCandidates requiring assertion review before baseline:promote:"
    );
    for (const id of result.newlyPassing) console.log(`  + ${id}`);
  }

  if (result.regressions.length > 0) {
    console.log("\nREGRESSIONS:");
    for (const id of result.regressions) console.log(`  - ${id}`);
    process.exit(1);
  }

  if (reconciled !== result.total) {
    console.error(
      `\nERROR: Reconciliation mismatch (${reconciled} ≠ ${result.total}).`
    );
    process.exit(1);
  }

  console.log("\n✓ No regressions.");
}

// ── Main ────────────────────────────────────────────────────────────

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], "file://").href;

if (isMain) {
  const command = process.argv[2];
  switch (command) {
    case "promote": {
      requireCorpusIntegrity(2);
      const entries = runCorpus();
      doUpdate(entries);
      break;
    }
    case "check": {
      requireCorpusIntegrity(2);
      const entries = runCorpus();
      doCheck(entries);
      break;
    }
    default:
      console.error(
        "Usage: upstream-baseline.mjs check | promote <test-id> <method> <evidence>"
      );
      process.exit(1);
  }
}
