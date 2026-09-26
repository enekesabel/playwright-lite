# Playwright compatibility

When implementing Page or Locator behavior, inspect the pinned Playwright implementation and its corresponding tests first. Reuse the pinned browser primitives where available. Explain any remaining behavioral differences in the change report.

`createPage()` returns Playwright's `Page` type unchanged; never narrow, intersect or replace it. Unsupported members stay on the type and fail at runtime (ADR 0001).

Keep copied upstream specs byte-for-byte identical to their pinned source. Change the package harness or runtime when necessary; compatibility operations must execute through the browser adapter.

## Upstream fixture setup

Unchanged corpus specs that only need `goto` to establish their test
document/origin are listed in `nativeNavigationForSetupSpecs`
(`tests/upstream/pageTest.ts`) and run that call on the native driver. These
calls are recorded as `Page.goto` in native execution evidence. They can never
certify navigation compatibility. No failed adapter call is retried via the
native driver. Every operation under review and every assertion in those specs
still uses the browser adapter. Native `goto` ends at the test's first adapter
call: a listed spec's later `goto` routes through the adapter like any other
member and fails there, so a mid-test navigation is never faked. Out-of-scope
setup members such as `setContent` have no such cutoff: they are never under
review, so promotion accepts them wherever they ran (see Baseline promotion).
`Selectors.register` is the one adapter call that does not end native setup
navigation: Playwright's registry is Playwright-wide (pinned
`client/selectors.ts` keeps `_selectorEngines` per instance and
`server/dom.ts` hands `customEngines` to every InjectedScript it creates), so
the bridge repeats an accepted registration in each later document through an
init script. That repeat waits for the adapter bootstrap, since Playwright
leaves init-script order undefined. It is not recorded as a call, the evidence
holds only the test's own call, a repeat that fails or never meets a bootstrap
is recorded in the execution evidence's `failures`, and a rejected or sabotaged
registration is never repeated. The next adapter member still ends native
`goto`.

Specs whose subject is navigation itself (`page-goto.spec.ts`) are never listed.
A goto-as-subject test inside a listed mixed file can still pass
diagnostically — its setup navigation succeeded natively — but promotion
refuses it, because `Page.goto` never entered the adapter and the recorded
evidence shows the call in the native operation log instead.

Library highlight tests use the pinned
InjectedScript's test mode to expose its shadow root; direct runtime tests also
verify the production closed-root overlay without changing its mode.

Fixture assets under `tests/assets/` are copied byte-for-byte from the same
pinned commit as the specs (`corpus.source` in `tests/upstream/corpus.ts`).

## Harness trust

The bridge (`tests/upstream/adapter-bridge.ts`) and the fixture
(`tests/upstream/pageTest.ts`) are transport only: they serialize arguments,
route them into the browser adapter and reconstruct what comes back. They never
compute a result themselves, branch on spec or test names, or catch an error and
substitute a value.

A harness change is accepted on tests that fail with an adapter error instead of
a bridge error, not on tests turning green: the remaining failure must come from
the adapter under test. A harness pull request promotes nothing.

Out-of-scope `Page` and `Locator` members run on the native driver so tests that
mix them with in-scope members stay diagnostic. Each such call, and each member
called on what one returns, is recorded in the evidence's `native` log.
`Page.url()`, `Locator.toString()` and `Locator.description()` are synchronous,
so the bridge answers them in Node: `url()` replays the adapter's latest answer,
and the locator members are answered by the pinned client's own Locator for the
same chain, which a guard pins to the adapter's answers. Each call is recorded in
the evidence's `answeredInNode` log, library-created pages included (ADR-0002).

Functions cannot cross `realPage.evaluate`, so the bridge carries a function
argument as its source and rebuilds it in the browser, normalizing a method
shorthand the way the pinned server normalizes a page function. The rebuilt
function has no Node closure: a test whose callback must run in Node
(`exposeFunction`, event handlers) still fails, in the adapter rather than in the
bridge. The one name the bridge binds in that scope is `expect`, which resolves
to the adapter's public expect, so an event handler can assert with its generic
matchers; a failing assertion there is still only logged by the package's
listener rule. Every payload crosses `realPage.evaluate` as one string, written
and read by the bridge's transport codec, so it never depends on the page's
mutable prototypes. The codec follows the pinned `utilityScriptSerializers.ts`
and `protocol/serializers.ts` rules and computes nothing: `Date`, `URL`,
`Error`, `RegExp`, `BigInt`, typed arrays, `ArrayBuffer`, the special numbers
and shared or cyclic references keep their kind; every other object travels as
its own enumerable properties, which is those serializers' object branch. Node's
side refuses a function and an invalid `Date` as Playwright's client does; the
page's side drops a function as the utility script does. A live
Playwright driver object obtained from an out-of-scope native member is the one
argument the bridge still refuses, because this adapter cannot make its identity
mean anything.

An adapter handle cannot cross that boundary by value either, so whichever member
returns one — alone or inside an array — the browser side stores it and the Node
side republishes it as a handle proxy. A handle is recognized by the surface the
adapter's ElementHandle and JSHandle share, `dispose` together with `asElement` or
`jsonValue`. A handle whose `asElement()` is itself is an ElementHandle and one
that answers `null` is a JSHandle, which is the kind the evidence records.

## Baseline promotion

Treat newly passing upstream tests as candidates for review. Ordinary corpus runs
give a test outside the reviewed baseline a 5 s timeout (`knownFailureTimeout` in
`tests/upstream/pageTest.ts`), so a candidate that needs longer shows there as a
timeout; `baseline:promote` runs every test under the full timeout. Before
promoting each test:

1. Read the complete test and relevant setup, then inspect its recorded adapter execution.
2. Identify the Page or Locator method under test and the assertion that checks its behavior.
3. Confirm the intended method executed and the result was not produced by a transport error, unsupported dispatch, swallowed setup failure, or an unrelated assertion. A test without a meaningful assertion remains diagnostic.
4. Record the exact test ID, method, and a concise explanation of what the assertion proves in the existing baseline through the promotion command.
5. The promotion command reruns each candidate alone with that method sabotaged: its in-browser adapter dispatch throws instead of executing, on the fixture's page and on every page a library test creates, and the test's execution evidence records each withheld dispatch in `withheld`, which only a method-sabotaged run's evidence has; evidence carrying it never certifies an ordinary pass. A sabotaged public matcher is not dispatched either: it fails with its withheld marker as the error's `message` and as `matcherResult.message`, `.ariaSnapshot` and `.log`, with no other `matcherResult` field. The test must fail or time out with no transport failure in its evidence; a test that still passes proves nothing about the method and is refused. The method rerun is accepted only when the evidence records a withheld dispatch of the reviewed method, whatever the failure's text, so a test that asserts the error's class or reads its `matcherResult` still counts and a failure that never reached the method is refused. The matcher rerun needs `__pwLiteSabotagedMatcher: <matcher>` in the reported failure. Errors the rerun reports outside any test are logged and leave the verdict to the test's own result. The rerun passes the method as a fixture option in a configuration it generates for that run alone; no environment variable is involved, so the switch is off in every ordinary corpus run and no upstream spec sets it.
6. Run the package compatibility checks and inspect the baseline diff. Review each new entry as part of the PR; ordinary test runs must never promote entries automatically.

Promotion refuses, and `baseline:check` counts as a regression, a test whose
`native` log holds any member outside the setup list in
`scripts/upstream-baseline.mjs` (`Page.goto`, `Page.setContent`,
`Page.setViewportSize`, `Browser.newContext`, `BrowserContext.newPage`,
`BrowserContext.close`). A native member joins the setup list only when its
native call can never be the subject of a promotion and it serves to establish
the document under test; anything else recorded natively refuses promotion.
Promotion also refuses a test whose reviewed method is in its `answeredInNode`
log; contract tests prove those members. Review refuses a test that asserts a
transport artefact (user activation, the CSP `eval` exemption, CDP error text)
or a callback that must run in Node; such tests stay diagnostic (ADR-0002).

Execution tracking is necessary evidence, not proof that an assertion is adequate. The implementing agent performs this review; individual promotions do not require separate user approval. Preserve existing reviewed entries when adding support, and investigate regressions instead of deleting entries to make CI pass.

Promoting a reviewed ID under a method or matcher other than its reviewed ones is refused unless the promotion is flagged `--re-record`. A regressed reviewed entry passes the promotion gate only through a promotion flagged `--re-record`, and only when the harness now records the same member under the new owner of an owner correction enumerated in `scripts/upstream-baseline.mjs` (currently only `JSHandle` → `ElementHandle`, so `JSHandle.asElement` becomes `ElementHandle.asElement`; adding a pair is itself a reviewed harness change): the test still passes with clean execution evidence, the old method did not run natively, and the matcher stays the same, which in practice means the entry has none, because a re-record cannot set one. The new method still goes through the sabotage rerun; pass the reviewed evidence unchanged.

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
  `option-validation`, `strictness`, `serialization`, `page-globals`.
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
Explain them once in that section, one short line per boundary, with a
subsection for mechanics several APIs share; an API keeps its status despite
them.

Compatibility documents only differences from the pinned Playwright public
JavaScript API, each stated concretely as what Playwright does and what this
package does instead. Each behaviour is explained once, in the section that owns
it, and every other mention is a link:

- A table note is one line naming the difference (a missing option or input
  form, a changed selection or return value) plus a link to the owning section.
- Events owns the supported events: what fires each one and how its payload and
  timing differ. The event-emitter rows link there.
- Expect holds three tables, in order: Locator assertions (one row per
  `expect(locator)` matcher), Page assertions (one row per `expect(page)`
  matcher), and Generic expect (`expect(value)`, the `expect` members, and
  plain-text rows for assertion families with no in-document target).
- Each returned-object section states what it covers, then "Not available:"
  (the missing members, omitted when there are none), then "Differences from
  Playwright:": a Member | playwright-lite | Playwright table for differences
  tied to one member, and one-line bullets for the rest.
- A difference a typical user of that API would not run into goes in the
  section's collapsed "Edge cases" block.
- An explanation stays only when it lets the reader predict behaviour beyond the
  listed cases, as one short clause. How this package works inside stays in the
  source.

Use Playwright's public JavaScript terminology and this package's public exports.
Call the application under automation "the page" or "the document".
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

CI lints PR titles with commitlint against `commitlint.config.js`. Use `feat` or `fix` only for adapter behaviour consumers see, and `test` for harness, corpus and promotion work. Leave out the scope; only Release Please uses `chore(release)`. Check a title locally:

```sh
echo "feat: add locator support" | pnpm commitlint
```

## Development environment

- Start a persistent Devbox shell and run all project commands inside it.
- If Devbox is unavailable, surface the environment blocker.
