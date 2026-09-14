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

## Development environment

- Start a persistent Devbox shell and run all project commands inside it.
- If Devbox is unavailable, surface the environment blocker.
