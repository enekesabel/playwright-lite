# Playwright compatibility

When implementing Page or Locator behavior, inspect the pinned Playwright implementation and its corresponding tests first. Reuse the pinned browser primitives where available. Explain any remaining behavioral differences in the change report.

Keep copied upstream specs byte-for-byte identical to their pinned source. Change the package harness or runtime when necessary; compatibility operations must execute through the browser adapter.

## Upstream fixture setup

The unchanged storage, library highlight and pointer-action corpus specs use
explicitly enabled native `goto` only to establish their test document/origin.
These calls are recorded as `Page.goto` in native execution evidence. They can
never certify navigation compatibility. No failed adapter call is retried via
the native driver. All storage/highlight/pointer operations under review and assertions use the
browser adapter. Library highlight tests use the pinned InjectedScript's test
mode to expose its shadow root; direct runtime tests also verify the production
closed-root overlay without changing its mode.

## Baseline promotion

Treat newly passing upstream tests as candidates for review. Before promoting each test:

1. Read the complete test and relevant setup, then inspect its recorded adapter execution.
2. Identify the Page or Locator method under test and the assertion that checks its behavior.
3. Confirm the intended method executed and the result was not produced by a transport error, unsupported dispatch, swallowed setup failure, or an unrelated assertion. A test without a meaningful assertion remains diagnostic.
4. Record the exact test ID, method, and a concise explanation of what the assertion proves in the existing baseline through the promotion command.
5. Run the package compatibility checks and inspect the baseline diff. Review each new entry as part of the PR; ordinary test runs must never promote entries automatically.

Execution tracking is necessary evidence, not proof that an assertion is adequate. The implementing agent performs this review; individual promotions do not require separate user approval. Preserve existing reviewed entries when adding support, and investigate regressions instead of deleting entries to make CI pass.

## Contract tests

Contract tests are the package's own tests. They drive the public API in a
browser and live under `tests/contract/`. They cover adapter-specific behaviour
(unsupported-option rejection, the single-document boundary, this package's
error messages, packaging) and Playwright behaviour the corpus cannot reach. A
behaviour already proven by a reviewed baseline entry needs no contract test.

Place a test by the member whose behaviour it asserts:

- A `Page` or `Locator` member is tested in `tests/contract/<member>.test.ts`,
  named exactly like the member (`click.test.ts`, `waitForSelector.test.ts`).
  Inside, `describe("Locator.<member>")` holds the shared behaviour and
  `describe("Page.<member>")` holds only what differs on Page. Placement must be
  mechanical, and the two forms share one implementation.
- Every other owner gets one file: `keyboard.test.ts`, `element-handle.test.ts`,
  `js-handle.test.ts`, `expect.test.ts`, `package.test.ts`.
- A rule asserted across two or more members goes in
  `tests/contract/rules/<rule>.test.ts`, written once as a case table of
  `[apiName, run]`. The rule files are `cancellation`, `timeouts`,
  `option-validation`, `strictness`, `serialization`.
- Using other members as setup does not make a test cross-API; it stays with the
  member it asserts. Multi-API scenarios are the corpus's job.

Do not test internal modules directly. Exception: an internal module with real
logic of its own and a stable interface keeps a test next to its source.

## Consumer README

`README.md` is generated from `docs/readme-template.hbs` and
`compatibility/api.ts`. Edit those
sources, not the output, then run `pnpm generate:readme`. `pnpm check` rejects drift.

The README is for consumers. Keep contributor setup, Devbox, CI, implementation
architecture, and corpus/baseline mechanics out of it. Installation instructions
must describe a verified distribution path, not an assumed registry release.

Runtime boundaries are constraints of running inside the current document.
Explain them once in that section; they do not by themselves downgrade an API.
Compatibility notes describe concrete differences from the pinned Playwright
public JavaScript API: name missing options or input forms, and contrast changed
selection behavior or return values with Playwright. Do not call normal
Playwright behavior a limitation. Avoid undefined terms such as "limited";
list the exact returned-handle differences once and reference them from rows.

Use Playwright's public JavaScript terminology and this package's public exports.
Do not document internal types/helpers as consumer API, or borrow type names from
other language bindings. Use the documented object shape when no public type is
named. Link documented members to verified official anchors; leave members with
no individual documentation unlinked rather than inventing links.

Live documentation links are navigation, not compatibility evidence. Review the
pinned signatures, implementation, unchanged upstream tests, and reviewed evidence
before changing a ledger claim. When support or evidence changes, update the
ledger and regenerate in the same change. Keep section-specific editing guidance
in Handlebars comments so it does not appear in the generated README.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `enekesabel/playwright-lite`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## Release process

Follow `docs/RELEASE_PROCESS.md` for releases. Keep maintainer release instructions out of the consumer README.

PR titles must use Conventional Commit syntax. Use squash merge for normal PRs so the title becomes the commit on `main`.

## Development environment

- Start a persistent Devbox shell and run all project commands inside it.
- If Devbox is unavailable, surface the environment blocker.
