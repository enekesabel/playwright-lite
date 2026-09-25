#!/usr/bin/env node
/**
 * Manages the upstream compatibility baseline.
 *
 * Commands:
 *   check   verify corpus integrity → run tests → gate against baseline
 *   promote <test-id> <method> [--matcher <matcher> | --re-record] <evidence>
 *           rerun corpus and promote a reviewed test; each flag goes after <method>
 *     --matcher <matcher>  the public matcher an _expect promotion proves
 *     --re-record          correct an existing entry whose method's owner the harness
 *                          renamed, by a pair listed in OWNER_CORRECTIONS;
 *                          it sets no matcher, so it cannot be combined with --matcher
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { stripVTControlCharacters } from "node:util";
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
          titlePath: [...titlePath, spec.title].filter(Boolean),
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

// ── Report-level errors ──────────────────────────────────────────────

/**
 * Read a report's top-level `errors`: errors Playwright reported outside any
 * test, such as collection or runner failures. Returns the first line of each
 * message (empty when there are none); callers decide what they mean.
 */
export function reportErrorMessages(report) {
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
            certifiesBrowserMethod(entry, review.method, review.matcher)
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

/**
 * A passing test with clean adapter evidence. Evidence that carries `withheld`,
 * even empty, comes from a method rerun, never from an ordinary run, so it
 * certifies nothing.
 */
export function isCandidate(entry) {
  return (
    entry.status === "passed" &&
    entry.execution?.entered?.length > 0 &&
    entry.execution?.failures?.length === 0 &&
    entry.execution?.withheld === undefined
  );
}

function isOutOfScopeMethod(method) {
  const [owner, member] = method.split(".", 2);
  if (owner !== "Page" && owner !== "Locator") return false;
  return statusFor(owner, member) === "out-of-scope";
}

function isPublicExpectMethod(method) {
  return method === "Locator._expect" || method === "Page._expect";
}

function publicExpectOwner(method) {
  if (method === "Locator._expect") return "Locator";
  if (method === "Page._expect") return "Page";
  return undefined;
}

function matcherMatchesMethodOwner(method, matcher) {
  const owner = publicExpectOwner(method);
  return !owner || matcher?.startsWith(`${owner}.`) === true;
}

function hasPublicExpectEvidence(entry, method, matcher) {
  if (!isPublicExpectMethod(method)) return true;
  if (!matcher) return false;
  return (
    matcherMatchesMethodOwner(method, matcher) &&
    entry.execution.expectPaths?.some(
      (path) => path.matcher === matcher && path.method === method
    ) === true
  );
}

function certifiesBrowserMethod(entry, method, matcher) {
  return (
    !isOutOfScopeMethod(method) &&
    entry.execution.entered.includes(method) &&
    !entry.execution.native?.includes(method) &&
    hasPublicExpectEvidence(entry, method, matcher)
  );
}

export function reviewedPromotion(entries, id, method, evidence, matcher) {
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
  if (isPublicExpectMethod(method) && !matcher)
    throw new Error(
      "Public expect promotions require an explicit matcher name."
    );
  if (matcher && !matcherMatchesMethodOwner(method, matcher))
    throw new Error(
      "Public expect matcher owner must match the promoted adapter owner."
    );
  if (
    isPublicExpectMethod(method) &&
    !hasPublicExpectEvidence(entry, method, matcher)
  )
    throw new Error(
      "Promotion requires matching correlated public expect path evidence."
    );
  if (
    matcher &&
    !isPublicExpectMethod(method) &&
    !entry.execution.expect?.includes(matcher)
  )
    throw new Error(
      "Promotion requires matching public expect matcher execution evidence."
    );
  if (!evidence?.trim())
    throw new Error("Explain what the reviewed assertion proves.");
  return {
    id,
    method,
    ...(matcher ? { matcher } : {}),
    evidence: evidence.trim(),
  };
}

/**
 * The owner corrections `--re-record` accepts, as [reviewed owner, new owner]
 * pairs for the same member. Each pair is a harness change that renamed the
 * owner it records a member under; adding one is itself a reviewed harness
 * change.
 */
const OWNER_CORRECTIONS = [["JSHandle", "ElementHandle"]];

function isOwnerCorrection(reviewedMethod, method) {
  const split = (method) => {
    const dot = method.indexOf(".");
    return [method.slice(0, dot), method.slice(dot + 1)];
  };
  const [reviewedOwner, reviewedMember] = split(reviewedMethod);
  const [owner, member] = split(method);
  return (
    member === reviewedMember &&
    OWNER_CORRECTIONS.some(
      ([from, to]) => from === reviewedOwner && to === owner
    )
  );
}

/**
 * The baseline regressions that block a promotion run.
 *
 * A promotion never changes a reviewed entry's method or matcher unless it is
 * listed in `reRecords`; one that would is refused. A promotion listed in `reRecords`
 * corrects an existing reviewed entry that regressed only because the harness
 * renamed its recorded method's owner (it now records
 * `ElementHandle.asElement` where it recorded `JSHandle.asElement`): the test
 * still passes with clean execution evidence, the new method is the same
 * member under the new owner of a pair in `OWNER_CORRECTIONS`, and the matcher
 * is unchanged. Such an entry does not block its own correction. An entry
 * whose recorded method now runs natively regressed, whatever the new method
 * is. A re-record that is not such a correction is refused, and every other
 * regression still blocks. The re-recorded method still goes through the
 * sabotage rerun like any promotion.
 *
 * @param {Array} entries  Parsed test entries.
 * @param {{ reviewed: Array<{id: string, method: string, matcher?: string}> }} baseline  Recorded baseline.
 * @param {readonly string[]} names  Corpus spec filenames.
 * @param {Array<{id: string, method: string, matcher?: string}>} promotions  Checked promotions.
 * @param {ReadonlySet<string>} reRecords  IDs of promotions that correct an existing entry.
 */
export function blockingRegressions(
  entries,
  baseline,
  names,
  promotions,
  reRecords
) {
  const claim = ({ method, matcher }) =>
    matcher ? `${method} --matcher ${matcher}` : method;
  for (const promotion of promotions) {
    const reviewed = baseline.reviewed.find(
      (review) => review.id === promotion.id
    );
    if (
      reviewed &&
      claim(reviewed) !== claim(promotion) &&
      !reRecords.has(promotion.id)
    )
      throw new Error(
        `${promotion.id} is already reviewed as ${claim(reviewed)}; promoting it as ${claim(promotion)} would replace that claim. Pass --re-record to correct its method's owner; a re-record keeps the matcher.`
      );
  }
  const { regressions } = compareBaseline(entries, baseline, names);
  for (const id of reRecords) {
    const promotion = promotions.find((promotion) => promotion.id === id);
    const reviewed = baseline.reviewed.find((review) => review.id === id);
    const entry = entries.find((entry) => entry.id === id);
    if (!promotion || !reviewed)
      throw new Error(
        `--re-record corrects an existing reviewed entry; ${id} has none.`
      );
    if (!regressions.includes(id))
      throw new Error(
        `${id} still certifies ${reviewed.method}, so there is nothing to re-record.`
      );
    if (entry?.execution?.native?.includes(reviewed.method))
      throw new Error(
        `${id} now runs ${reviewed.method} natively; that is a regression to investigate, never an owner rename to re-record.`
      );
    if (
      !entry ||
      !isCandidate(entry) ||
      !isOwnerCorrection(reviewed.method, promotion.method) ||
      promotion.matcher !== reviewed.matcher
    )
      throw new Error(
        `${id} can be re-recorded from ${reviewed.method} as ${promotion.method} only if that is a listed owner correction (${OWNER_CORRECTIONS.map(([from, to]) => `${from} -> ${to}`).join(", ")}) of the same member, with the same matcher and the test still passing.`
      );
  }
  return regressions.filter((id) => !reRecords.has(id));
}

/**
 * Verdict of the sabotage rerun: the same test re-run with the reviewed
 * method's in-browser dispatch throwing instead of executing, or, given a
 * matcher, with that public matcher withheld. A test that still passes is
 * vacuous about what was withheld, whatever the recorded evidence says. A test
 * must fail or time out, and only because of what was withheld; a failure with
 * another cause proves nothing either:
 *
 * - Its evidence records no transport failure, so the failure is not a bridge
 *   error.
 * - A method rerun needs its evidence to record a withheld dispatch of the
 *   method (`withheld`, which only a method rerun's evidence has). The
 *   failure's text is not consulted: a test that reads the error it gets back,
 *   such as its class or `matcherResult`, fails without printing the marker.
 * - A matcher rerun needs the reported failure to show the matcher's withheld
 *   marker, which a withheld matcher returns in every text field of its
 *   failure. A test that compares a whole message with `toBe` fails with
 *   Playwright's diff, whose ANSI inverse-video codes can split the marker, so
 *   the message is read with those codes removed.
 *
 * @param {Array} entries  Parsed entries of the sabotaged rerun.
 * @param {string} id  The promoted test.
 * @param {string} method  The reviewed method.
 * @param {string} [matcher]  The public matcher the rerun withheld instead.
 */
export function sabotageVerdict(entries, id, method, matcher) {
  const subject = matcher ?? method;
  const entry = entries.find((entry) => entry.id === id);
  if (!entry)
    throw new Error(
      `The rerun with ${subject} sabotaged did not run ${id}; promotion needs that observation.`
    );
  if (entry.status === "skipped")
    throw new Error(
      `The rerun with ${subject} sabotaged skipped ${id}, so it observed nothing.`
    );
  if (entry.status === "passed")
    throw new Error(
      `${id} still passes with ${subject} sabotaged, so it does not prove ${subject}.`
    );
  if (entry.status !== "failed" && entry.status !== "timedOut")
    throw new Error(
      `The rerun with ${subject} sabotaged ended ${id} as ${entry.status}; promotion needs it to fail or time out.`
    );
  if (entry.execution?.failures?.length)
    throw new Error(
      `${id} failed with ${subject} sabotaged, but its evidence records transport failures: ${entry.execution.failures.join("; ")}`
    );
  if (matcher) {
    const marker = `__pwLiteSabotagedMatcher: ${matcher}`;
    if (!stripVTControlCharacters(entry.error ?? "").includes(marker))
      throw new Error(
        `${id} failed with ${matcher} sabotaged, but not for the expected reason: ${marker}`
      );
  } else if (!entry.execution?.withheld?.includes(method))
    throw new Error(
      `${id} failed with ${method} sabotaged, but never reached it: its evidence records no withheld dispatch of ${method}.`
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
 * Validate that a corpus report covers the corpus completely and record its
 * diagnostics.
 *
 * @param {string} reportPath  A Playwright JSON report of a corpus run.
 * @param {string} provenance  How the report was produced, for the log line.
 */
function readCorpus(reportPath, provenance) {
  const report = loadAndValidateReport(reportPath, 2);
  mkdirSync(resolve(PKG_ROOT, "test-results"), { recursive: true });
  writeFileSync(
    resolve(PKG_ROOT, "test-results/compatibility.json"),
    JSON.stringify(
      report.entries.map((entry) => ({ ...entry, phase: failurePhase(entry) })),
      null,
      2
    ) + "\n"
  );

  console.log(
    `Corpus: ${report.specCount} specs, ${report.testCount} tests (${provenance})`
  );
  return report.entries;
}

/**
 * Run the corpus and validate that the report covers it completely.
 */
function runCorpus() {
  const exitCode = runPlaywright(
    specNames.map((s) => `tests/upstream/${s}`),
    REPORT_PATH
  );
  return readCorpus(REPORT_PATH, `Playwright exit ${exitCode}`);
}

/**
 * Write the configuration the sabotage rerun runs with: the package
 * configuration, with the withheld method as a literal in its `use` block.
 * Workers re-evaluate this file, so the method never travels through the
 * environment, where a spec could set it.
 */
function writeSabotageConfig(method, matcher) {
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
      `  use: { ...config.use, sabotagedMethod: ${JSON.stringify(method)}, sabotagedMatcher: ${JSON.stringify(matcher ?? null)} },`,
      "};",
    ].join("\n") + "\n"
  );
}

/**
 * Build the --grep pattern for a test's title path (its enclosing
 * `test.describe` titles, in order, followed by its own title).
 *
 * The serialized "file > title" id is ambiguous when a describe title or the
 * test title itself contains " > ", so the rerun greps from the report's
 * structured title path instead of reparsing the id.
 *
 * This reproduces what Playwright 1.62.1 matches --grep against:
 * `_grepTitleWithTags()` (playwright/lib/common/index.js) joins the test's
 * full title path (including project and file segments, which precede ours)
 * with tags appended after. The match is unanchored, so our escaped title
 * path alone still matches as a substring — tags never need to be included.
 */
export function sabotageGrep(titlePath) {
  return titlePath.join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rerun a single corpus test with the reviewed method sabotaged: the fixture
 * makes the in-browser adapter dispatch for that method throw instead of
 * executing it.
 */
function runSabotaged(entry, method, matcher) {
  const target = matcher ?? method;
  console.log(`\nRerunning ${entry.id} with ${target} sabotaged…`);
  writeSabotageConfig(matcher ? null : method, matcher);
  runPlaywright(
    [
      `--config=${SABOTAGE_CONFIG_PATH}`,
      resolve(PKG_ROOT, `tests/upstream/${entry.file}`),
      "--grep",
      sabotageGrep(entry.titlePath),
    ],
    SABOTAGE_REPORT_PATH
  );
  return sabotageRerunEntries(
    JSON.parse(readFileSync(SABOTAGE_REPORT_PATH, "utf8"))
  );
}

/**
 * Parse the report of a sabotage rerun into entries for sabotageVerdict.
 *
 * Errors reported outside any test are logged, not fatal: a test's unawaited
 * call can settle on a closed page after the test ended, and the verdict comes
 * from the test's own result. A rerun too broken to produce that result fails
 * earlier, in runPlaywright, or gets refused by sabotageVerdict.
 */
export function sabotageRerunEntries(report) {
  const errors = reportErrorMessages(report);
  if (errors.length > 0) {
    console.warn("Sabotage rerun reported errors outside any test:");
    for (const e of errors) console.warn(`  ${e}`);
  }
  return parseReport(report);
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
  const reportErrors = reportErrorMessages(raw);
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

/**
 * Splits `promote` arguments into promotion requests. Each request is
 * `<test-id> <method>`, then `--matcher <matcher>` or `--re-record` in any
 * order, then `<evidence>`. A re-record sets no matcher, so the two flags
 * conflict.
 *
 * @param {readonly string[]} args  Arguments after `promote` (and `--`).
 * @returns {{ requests: Array<{id: string, method: string, matcher?: string, evidence: string}>, reRecords: Set<string> }}
 */
export function parsePromotionArgs(args) {
  const requests = [];
  const reRecords = new Set();
  for (let index = 0; index < args.length;) {
    const id = args[index++];
    const method = args[index++];
    if (!id || !method)
      throw new Error("Each promotion requires a test ID and adapter method.");
    let matcher;
    let reRecord = false;
    for (;;) {
      if (args[index] === "--matcher") {
        matcher = args[index + 1];
        if (!matcher || matcher.startsWith("--"))
          throw new Error("--matcher requires a public matcher name.");
        index += 2;
      } else if (args[index] === "--re-record") {
        reRecord = true;
        index++;
      } else break;
    }
    if (reRecord && matcher)
      throw new Error(
        `${id}: --re-record cannot be combined with --matcher; a re-record corrects only the owner of the entry's method and sets no matcher.`
      );
    if (reRecord) reRecords.add(id);
    const evidence = args[index++];
    if (!evidence) throw new Error("Each promotion requires review evidence.");
    requests.push({ id, method, ...(matcher ? { matcher } : {}), evidence });
  }
  return { requests, reRecords };
}

function doUpdate(entries) {
  const corpusSpecs = new Set(specNames);
  const corpusEntries = entries.filter((e) => corpusSpecs.has(e.file));

  const args = process.argv.slice(3);
  if (args[0] === "--") args.shift();
  if (!args.length)
    throw new Error(
      "Provide one or more <test-id> <method> [--matcher <matcher> | --re-record] <evidence> promotions."
    );
  const { requests, reRecords } = parsePromotionArgs(args);
  const promotions = requests.map(({ id, method, evidence, matcher }) =>
    reviewedPromotion(entries, id, method, evidence, matcher)
  );
  if (new Set(promotions.map((entry) => entry.id)).size !== promotions.length)
    throw new Error("Each promoted test ID must be unique.");
  const previous = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const blocking = blockingRegressions(
    entries,
    previous,
    specNames,
    promotions,
    reRecords
  );
  if (blocking.length)
    throw new Error(
      `Resolve existing baseline regressions before promoting tests: ${blocking.join(", ")}`
    );
  for (const { id, method, matcher } of promotions) {
    const entry = entries.find((entry) => entry.id === id);
    sabotageVerdict(runSabotaged(entry, method), id, method);
    if (matcher)
      sabotageVerdict(
        runSabotaged(entry, method, matcher),
        id,
        method,
        matcher
      );
  }
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

/**
 * Read `<flag> <value>` from the command's arguments.
 */
function argumentValue(flag) {
  const index = process.argv.indexOf(flag, 3);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) {
    console.error(`ERROR: ${flag} requires a value.`);
    process.exit(2);
  }
  return value;
}

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
      // `--report <path>`: judge a report produced elsewhere — CI merges the
      // blob reports of its corpus shards into one — instead of running the
      // corpus here. Every validation below is the same either way.
      const reportPath = argumentValue("--report");
      const entries = reportPath
        ? readCorpus(resolve(process.cwd(), reportPath), `from ${reportPath}`)
        : runCorpus();
      doCheck(entries);
      break;
    }
    default:
      console.error(
        "Usage: upstream-baseline.mjs check [--report <path>] | promote <test-id> <method> [--matcher <matcher> | --re-record] <evidence>"
      );
      process.exit(1);
  }
}
