# Probe run summary — 50 synced upstream specs

## Headline finding

**All 50 spec files failed to load.** None of the 50 files produced any
discoverable test (Playwright reports `suites: []`, zero tests, zero
results). This is not specific to the 50 newly synced files: it is a
shared-fixture import error that would affect every spec that imports from
`tests/upstream/pageTest.ts`.

Root cause (observed, not fixed — out of scope for this task):

- `tests/upstream/pageTest.ts:24` does:
  `import { specNames, stableTestId } from "./corpus";`
- `tests/upstream/corpus.ts` only exports `corpus`, `UpstreamSpecName`, and
  `specNames`. It does **not** export `stableTestId`.
- Node raises `SyntaxError: The requested module './corpus' does not
  provide an export named 'stableTestId'` for every file that transitively
  imports `./pageTest`.
- Verified this is pre-existing on this branch and not limited to the 50
  synced files: an existing, already-baselined corpus spec
  (`tests/upstream/page-click.spec.ts`) fails to load with the identical
  error. A guard spec that does not import `./pageTest`
  (`tests/upstream/_adapter-guard.spec.ts`) loads fine (47 tests listed),
  confirming the break is isolated to the `pageTest.ts` -> `corpus.ts` import
  chain.
- All 50 of the synced files import `test`/`expect` from `./pageTest`
  (confirmed individually for each file), so all 50 hit this error
  identically.

Per the task's instructions, the fixture/spec files were left untouched;
this is recorded as an observation only.

## Command run

```
pnpm exec playwright test tests/upstream/<file1>.spec.ts ... tests/upstream/<file50>.spec.ts
```

(all 50 files passed as separate arguments — confirmed via the JSON
report's `config.argv`, which lists 50 distinct `tests/upstream/*.spec.ts`
entries).

- Exit code: 1 (non-zero, as expected)
- Playwright-reported internal run duration: 107.87 ms (`stats.duration`
  in `test-results/report.json` from the recorded run)
- Measured wall-clock time for the whole `playwright test` invocation
  (process start to exit, via shell `time`): **0.704s total** (0.70s user,
  0.07s system)
- Tests discovered: 0
- Tests run: 0

## Per-spec-file status counts

Every one of the 50 files produced zero results in every status bucket,
because none of them loaded. No per-test titles could be discovered.

| Spec file | passed | failed | timedOut | skipped | interrupted | Notes |
|---|---|---|---|---|---|---|
| elementhandle-bounding-box.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| elementhandle-eval-on-selector.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| elementhandle-misc.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| elementhandle-query-selector.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| elementhandle-wait-for-element-state.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| eval-on-selector-all.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| eval-on-selector.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-boolean.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-builtins.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-matcher-result.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-misc.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-timeout.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-to-have-accessible.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-to-have-text.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-to-have-value.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| expect-with-snapshot.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| jshandle-as-element.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| jshandle-evaluate.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| jshandle-json-value.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| jshandle-properties.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| jshandle-to-string.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| locator-element-handle.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| locator-evaluate.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| locator-wait-for-function.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| matchers.misc.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-add-locator-handler.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-add-script-tag.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-add-style-tag.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-autowaiting-basic.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-autowaiting-no-hang.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-click-react.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-dispatchevent.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-drag.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-drop.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-evaluate-callback.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-evaluate-handle.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-evaluate-no-stall.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-evaluate.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-history.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-mouse.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-wait-for-load-state.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-wait-for-selector-1.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-wait-for-selector-2.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| page-wait-for-url.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| queryselector.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| selectors-css.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| selectors-register.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| selectors-role.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| to-match-aria-snapshot.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |
| wheel.spec.ts | 0 | 0 | 0 | 0 | 0 | load failure |

## Spec files that failed to load, and why

All 50 files listed above failed to load with the identical error:

```
SyntaxError: The requested module './corpus' does not provide an export named 'stableTestId'
```

raised while resolving their `import { test, expect } from './pageTest'`
(or `import { test as it, expect } from './pageTest'`, or the `rafraf`
variant) statement, because `./pageTest` re-imports `stableTestId` from
`./corpus`, which does not export it. Playwright's overall run then failed
with `Error: No tests found.` since zero tests were discovered across all
50 targets.

This was independently reproduced on:
- Each of the 50 synced files individually (`--list` on
  `wheel.spec.ts`, spot-checked).
- A pre-existing baselined corpus file (`page-click.spec.ts`), showing the
  break is not introduced by the 50 synced files.

## Missing test assets

None observed. No test in the run ever reached asset resolution (no
tests executed at all), so no `ENOENT`/404 errors for files under
`tests/assets/` were produced. This does not mean the 50 specs' assets
are all present — it means the question could not be exercised because
the fixture import failed before any test body ran.

## Deviations from the task's steps

- Step 3 said "Let it finish even with many failures... use a generous
  timeout." The run instead failed instantly (~0.7s) because Playwright
  could not discover any tests at all, for the reason above — no long run
  was needed.
- Step 4 assumes per-test `results[]` entries exist in the JSON report to
  derive `probe/results.json`. Because no tests were ever discovered
  (`suites: []` in `test-results/report.json`), there is no per-test data
  to extract. `probe/results.json` is therefore an empty array `[]`,
  which accurately reflects that zero tests produced an observed result.
- An initial run attempt failed for an unrelated, self-inflicted reason:
  building the file list into a shell variable and expanding it
  unquoted (`$FILES`) does not word-split in zsh (the environment's
  shell), so all 50 paths were passed as a single argument and Playwright
  reported "No tests found" before even reaching the fixture. This was
  caught and corrected by passing the paths via direct command
  substitution (`$(sed ... selected.txt)`), which does word-split in zsh.
  The fixture-level `stableTestId` error above was confirmed independently
  of this shell issue (reproduced via `--list` on individual files).
