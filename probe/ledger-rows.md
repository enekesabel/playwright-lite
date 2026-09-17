# Unledgered surfaces: `ElementHandle`, `JSHandle`, `expect` matchers

Pinned sources of truth (installed = pinned):

- `node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/types/types.d.ts`
  — `JSHandle` (L11776–11961), `ElementHandle extends JSHandle<Node>` (L11963–13834).
- `node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/types/test.d.ts`
  — `GenericAssertions` (L8114), `APIResponseAssertions` (L8795), `LocatorAssertions` (L8839),
  `PageAssertions` (L10095), `SnapshotAssertions` (L10300).
- Matcher runtime: `node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/lib/matchers/expect.js`.

Implementation under review:
`src/elementHandle.ts` (class `AdapterElementHandle`), `src/evaluation.ts` (class `AdapterJSHandle`),
`src/page.ts`, `src/locator.ts`, `src/index.ts`.

All `src/*` line numbers below are absolute paths under
`/Users/abelenekes/Desktop/Development/playwright-lite/.claude/worktrees/probe`.

---

## 1. `ElementHandle` — 45 members

Own members: 37. Inherited from `JSHandle`: 8 (`asElement`, `dispose`, `evaluate`,
`evaluateHandle`, `getProperties`, `getProperty`, `jsonValue`, `[Symbol.asyncDispose]`).

Counts: **implemented 21 · partial 6 · missing 18**.

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `$` | partial | Ignores the `strict` option; the query always resolves non-strictly. | `src/elementHandle.ts:87` (no options parameter; `strict` hard-coded `false` in the `resolveWithinElement` call at `src/elementHandle.ts:89-93`), `src/page.ts:253` |
| `$$` | implemented | | `src/elementHandle.ts:97`, `src/page.ts:266` |
| `$eval` | implemented | | `src/elementHandle.ts:103`, `src/page.ts:266`, `src/evaluation.ts:80` |
| `$$eval` | implemented | | `src/elementHandle.ts:124`, `src/evaluation.ts:80` |
| `asElement` | implemented | | `src/elementHandle.ts:176` |
| `boundingBox` | implemented | | `src/elementHandle.ts:218`, `src/page.ts:2090` |
| `check` | implemented | | `src/elementHandle.ts:55`, `src/page.ts:830`, options accepted at `src/page.ts:3713-3727` |
| `click` | partial | The `steps` option is unsupported. The action does not wait for navigation. | `src/elementHandle.ts:25`, `src/page.ts:526`; `steps` absent from the supported list at `src/page.ts:3717-3727` and rejected at `src/page.ts:3740-3748`; no navigation wait in `src/page.ts:567-688` |
| `contentFrame` | missing | | absent from `src/elementHandle.ts:17-267` |
| `dblclick` | partial | The `steps` option is unsupported. | `src/elementHandle.ts:35`, `src/page.ts:543`; `steps` rejected at `src/page.ts:3717-3748` |
| `dispatchEvent` | missing | | absent from `src/elementHandle.ts:17-267` |
| `dispose` | implemented | | `src/elementHandle.ts:250` |
| `evaluate` | partial | Rejects `exposeFunctions: true`. | `src/elementHandle.ts:138`, `src/evaluation.ts:21-34` |
| `evaluateHandle` | missing | | absent from `src/elementHandle.ts:17-267` |
| `fill` | missing | | absent from `src/elementHandle.ts:17-267` |
| `focus` | missing | | absent from `src/elementHandle.ts:17-267` |
| `getAttribute` | implemented | | `src/elementHandle.ts:168` |
| `getProperties` | missing | | absent from `src/elementHandle.ts:17-267` |
| `getProperty` | missing | | absent from `src/elementHandle.ts:17-267` |
| `hover` | implemented | | `src/elementHandle.ts:45`, `src/page.ts:813`, options accepted at `src/page.ts:3713-3727` |
| `innerHTML` | implemented | | `src/elementHandle.ts:164` |
| `innerText` | implemented | | `src/elementHandle.ts:157` |
| `inputValue` | implemented | | `src/elementHandle.ts:172`, `src/page.ts:2076` (pinned `timeout` is documented as ignored upstream, so ignoring it is not a difference) |
| `isChecked` | implemented | | `src/elementHandle.ts:211`, `src/page.ts:2100` |
| `isDisabled` | implemented | | `src/elementHandle.ts:187`, `src/page.ts:2100` |
| `isEditable` | implemented | | `src/elementHandle.ts:204`, `src/page.ts:2100` |
| `isEnabled` | implemented | | `src/elementHandle.ts:180`, `src/page.ts:2100` |
| `isHidden` | implemented | | `src/elementHandle.ts:200` |
| `isVisible` | implemented | | `src/elementHandle.ts:194` |
| `jsonValue` | missing | | absent from `src/elementHandle.ts:17-267` |
| `ownerFrame` | missing | | absent from `src/elementHandle.ts:17-267` |
| `press` | missing | | absent from `src/elementHandle.ts:17-267` |
| `screenshot` | missing | | absent from `src/elementHandle.ts:17-267` |
| `scrollIntoViewIfNeeded` | missing | | absent from `src/elementHandle.ts:17-267` |
| `selectOption` | missing | | absent from `src/elementHandle.ts:17-267` |
| `selectText` | missing | | absent from `src/elementHandle.ts:17-267` |
| `setChecked` | implemented | | `src/elementHandle.ts:75`, `src/page.ts:830` |
| `setInputFiles` | missing | | absent from `src/elementHandle.ts:17-267` |
| `tap` | missing | | absent from `src/elementHandle.ts:17-267` |
| `textContent` | implemented | | `src/elementHandle.ts:153` |
| `type` | missing | | absent from `src/elementHandle.ts:17-267` |
| `uncheck` | implemented | | `src/elementHandle.ts:64`, `src/page.ts:830` |
| `waitForElementState` | partial | The `signal` option is unsupported. | `src/elementHandle.ts:227`, `src/page.ts:2109`; only `timeout` is accepted at `src/page.ts:3852-3868` |
| `waitForSelector` | partial | The `strict` option is unsupported. | `src/elementHandle.ts:239`, `src/page.ts:412`; `strict` rejected at `src/page.ts:3836-3837` (`allowsStrict === false` is passed at `src/page.ts:417`) |
| `[Symbol.asyncDispose]` | missing | | absent from `src/elementHandle.ts:17-267` |

### Option coverage of the implemented `ElementHandle` pointer actions

The whole pinned option set is accepted and honoured except where noted.

| method | pinned options | accepted | rejected |
| --- | --- | --- | --- |
| `click` | `button, clickCount, delay, force, modifiers, noWaitAfter, position, scroll, signal, steps, timeout, trial` | all except `steps` | `steps` |
| `dblclick` | `button, delay, force, modifiers, noWaitAfter, position, scroll, signal, steps, timeout, trial` | all except `steps` | `steps` |
| `hover` | `force, modifiers, noWaitAfter, position, scroll, signal, timeout, trial` | all | — |
| `check` / `uncheck` / `setChecked` | `force, noWaitAfter, position, scroll, signal, timeout, trial` | all | — |
| `waitForElementState` | `signal, timeout` | `timeout` | `signal` |
| `waitForSelector` | `signal, state, strict, timeout` | `signal, state, timeout` | `strict` |
| `$` | `strict` | — (silently ignored, not rejected) | — |
| `inputValue` | `timeout` (upstream: ignored) | — (ignored, as upstream) | — |
| `evaluate` | `exposeFunctions` | `exposeFunctions: false`/absent | `exposeFunctions: true` |

`signal` is supported on `click`, `dblclick`, `hover`, `check`, `uncheck`, `setChecked` and
`waitForSelector`: it is in the supported list (`src/page.ts:3714-3716`), validated
(`src/protocolValidation.ts:31`), attached to the action deadline
(`src/page.ts:578`, `src/page.ts:1823-1829`) and polled during retry
(`src/page.ts:2177`).

---

## 2. `JSHandle` — 8 members

Only producer of a handle in this package: `Page.waitForFunction` (`src/page.ts:1635`,
`src/page.ts:1663`) returning `AdapterJSHandle` (`src/evaluation.ts:177`).
`Page.evaluateHandle` and `Locator.evaluateHandle` are `undecided` in the ledger, so no other
`JSHandle` reaches a consumer.

Counts: **implemented 2 · partial 0 · missing 6**.

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `asElement` | missing | | absent from `src/evaluation.ts:177-203` |
| `dispose` | implemented | | `src/evaluation.ts:198` |
| `evaluate` | missing | | absent from `src/evaluation.ts:177-203` |
| `evaluateHandle` | missing | | absent from `src/evaluation.ts:177-203` |
| `getProperties` | missing | | absent from `src/evaluation.ts:177-203` |
| `getProperty` | missing | | absent from `src/evaluation.ts:177-203` |
| `jsonValue` | implemented | | `src/evaluation.ts:194`, `src/evaluation.ts:134` |
| `[Symbol.asyncDispose]` | missing | | absent from `src/evaluation.ts:177-203` |

Note: the pinned `waitForFunction` return type is `SmartHandle<R>`, i.e. an `ElementHandle`
when the predicate returns a `Node`. This package always returns the same `AdapterJSHandle`,
so the `ElementHandle` members are absent even for DOM results — already stated in the
`Page.waitForFunction` ledger row (`compatibility/api.ts:210-212`).

---

## 3. `expect` matchers

### How a consumer obtains `expect`

**They cannot obtain it from this package.** `package.json` declares one export
(`"." → ./dist/index.mjs`) and `src/index.ts` exports exactly two names: the
`createPage` function (`src/index.ts:13`) and the `CreatePageOptions` type
(`src/index.ts:5`). No `expect`, no matcher registration, no `expect.extend` helper.

The only `expect` in scope is the one from the peer dependency
`@playwright/test` (`package.json` `peerDependencies: ">=1.29 <1.63"`). Two independent
facts make it unusable against objects produced by `createPage()`:

1. **Every locator/page matcher gates on `receiver._apiName`.** `toBeTruthy`, `toEqual` and
   `toMatchText` — the three shared entry points for all 27 `LocatorAssertions` matchers and
   all 4 `PageAssertions` matchers — call `expectTypes(receiver, ["Locator"|"Page"], name)`
   (`expect.js:12095`, `:12148`, `:12311`), which throws unless
   `receiver._apiName` equals the expected string (`expect.js:12036`).
   `src/` never defines `_apiName` on any object (no occurrence in `src/`).
   The only place it exists is the **test-only** corpus bridge,
   `tests/upstream/adapter-bridge.ts:1056` (`if (prop === "_apiName") return "Locator";`),
   which is not shipped (`package.json` `files: ["dist", ...]`).
2. **`@playwright/test`'s matcher runtime is Node-side.** `expect.js` requires `node:util`,
   `node:fs` etc.; this package runs inside the browser document. The contract test states the
   same constraint: "The vitest browser setup cannot load Playwright's own matcher runtime"
   (`tests/contract/expect.test.ts:7-11`).

What **is** implemented is the private-shaped protocol hook the matchers would call:
`Locator._expect(expression, options)` (`src/locator.ts:402`) → `PageImpl.expect`
(`src/page.ts:428`) → pinned `InjectedScript.expect` (`src/page.ts:466-521`).
There is no `PageImpl._expect`; `mainFrame()` returns the same `PageImpl`
(`src/page.ts:1060`), so page-level matchers have no hook at all.

### Feature support

| feature | supported? | evidence |
| --- | --- | --- |
| negation `.not` | Not reachable as `expect(...).not`. At the hook level `isNot` is honoured: it flips the success condition, the retry exit and the missing-element outcome. | `src/page.ts:431`, `src/page.ts:437`, `src/page.ts:3543-3578`; `tests/contract/expect.test.ts:66-78` |
| `timeout` | Not reachable. Hook honours it, defaulting to `DEFAULT_EXPECT_TIMEOUT` when it is not a number, clamped at 0. | `src/page.ts:432`, `src/page.ts:3532-3535` |
| `signal` (abort) | Not reachable. Hook honours it: pre-checked, re-checked each retry, and reported as `Error: The assertion was aborted: <reason>`. | `src/page.ts:433`, `src/page.ts:435`, `src/page.ts:444-450`, `src/page.ts:3581-3589` |
| `soft` | No. Purely client-side in `@playwright/test`; nothing in `src/`. | no occurrence in `src/` |
| `poll` | No. `expect.poll` is client-side in `@playwright/test`; nothing in `src/`. | no occurrence in `src/`; `expect.js:13377` |
| `toPass` | No. Client-side in `@playwright/test`; nothing in `src/`. | no occurrence in `src/`; `expect.js:12973` |
| `configure` | No. Nothing in `src/`. | no occurrence in `src/` |
| custom `message` | No. Nothing in `src/`. | no occurrence in `src/` |

### `LocatorAssertions` — 28 members (27 matchers + `not`)

Counts: **implemented 0 · partial 0 · missing 28**.

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `not` | missing | | `src/index.ts:13` (no `expect` export); no `_apiName` in `src/` |
| `toBeAttached` | missing | | as above |
| `toBeChecked` | missing | | as above |
| `toBeDisabled` | missing | | as above |
| `toBeEditable` | missing | | as above |
| `toBeEmpty` | missing | | as above |
| `toBeEnabled` | missing | | as above |
| `toBeFocused` | missing | | as above |
| `toBeHidden` | missing | | as above |
| `toBeInViewport` | missing | | as above |
| `toBeVisible` | missing | | as above |
| `toContainClass` | missing | | as above |
| `toContainText` | missing | | as above |
| `toHaveAccessibleDescription` | missing | | as above |
| `toHaveAccessibleErrorMessage` | missing | | as above |
| `toHaveAccessibleName` | missing | | as above |
| `toHaveAttribute` | missing | | as above |
| `toHaveCSS` | missing | | as above |
| `toHaveClass` | missing | | as above |
| `toHaveCount` | missing | | as above |
| `toHaveId` | missing | | as above |
| `toHaveJSProperty` | missing | | as above |
| `toHaveRole` | missing | | as above |
| `toHaveScreenshot` | missing | | as above; additionally `Page.screenshot`/`_expectScreenshot` absent from `src/` |
| `toHaveText` | missing | | as above |
| `toHaveValue` | missing | | as above |
| `toHaveValues` | missing | | as above |
| `toMatchAriaSnapshot` | missing | | as above; also requires a Playwright `testInfo` (`expect.js:13036-13038`) |

### `PageAssertions` — 5 members (4 matchers + `not`)

Counts: **implemented 0 · partial 0 · missing 5**.

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `not` | missing | | `src/index.ts:13`; no `_apiName` in `src/` |
| `toHaveTitle` | missing | | calls `page.mainFrame()._expect("to.have.title", ...)` (`expect.js:12936`); `mainFrame()` returns the `PageImpl` (`src/page.ts:1060`) and `PageImpl` has no `_expect` (only `expect(selector, ...)` at `src/page.ts:428`) |
| `toHaveURL` | missing | | calls `page.context()._options.baseURL` (`expect.js:12944`) and `page.mainFrame().waitForURL(...)` / `_expect("to.have.url")` (`expect.js:12228`, `:12948`); `context` and `waitForURL` are `undecided` in `compatibility/api.ts:92,221` and absent from `src/page.ts` |
| `toMatchAriaSnapshot` | missing | | calls `receiver.mainFrame()._expect("to.match.aria", ...)` (`expect.js:13071`); no `PageImpl._expect` |
| `toHaveScreenshot` | missing | | requires `testInfo` and `page._expectScreenshot` (`expect.js:12588`, `:12632`); neither exists in `src/` |

### `APIResponseAssertions` — 2 members

Node-side only; `APIResponse` has no counterpart in this package (`Page.request` is
`undecided`, `compatibility/api.ts:175`).

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `not` | missing (Node-side) | | n/a |
| `toBeOK` | missing (Node-side) | | `expect.js:12951-12953` requires an `APIResponse` (`expectTypes(response, ["APIResponse"])`) |

### `GenericAssertions<R>` — 26 members

These operate on plain JavaScript values and never touch a `Page`/`Locator`. They are part of
`@playwright/test`'s Node-side `expect` and are neither re-exported nor affected by this
package.

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `not`, `resolves`, `rejects`, `toBe`, `toBeCloseTo`, `toBeDefined`, `toBeFalsy`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeInstanceOf`, `toBeLessThan`, `toBeLessThanOrEqual`, `toBeNaN`, `toBeNull`, `toBeTruthy`, `toBeUndefined`, `toContain`, `toContainEqual`, `toEqual`, `toHaveLength`, `toHaveProperty`, `toMatch`, `toMatchObject`, `toStrictEqual`, `toThrow`, `toThrowError` | missing (not re-exported; value-only, Node-side) | | `src/index.ts:13` is the package's only runtime export |

### `SnapshotAssertions` — 1 member

| member | state | difference | evidence |
| --- | --- | --- | --- |
| `toMatchSnapshot` | missing (Node-side; needs `testInfo`) | | no occurrence in `src/` |

### Supplementary: which `_expect` expressions the hook already serves

This is *not* consumer-facing state; it records what would be reachable if the matchers were
made reachable. Expression support comes from the pinned `InjectedScript` compiled into
`build/generated/injectedScriptSource.ts`; the adapter forwards the expression and all options
except `timeout`/`signal` (`src/page.ts:495-521`).

| matcher | `_expect` expression | expression served by the pinned InjectedScript |
| --- | --- | --- |
| `toBeAttached` | `to.be.attached` / `to.be.detached` | yes |
| `toBeChecked` | `to.be.checked` | yes |
| `toBeDisabled` | `to.be.disabled` | yes |
| `toBeEditable` | `to.be.editable` / `to.be.readonly` | yes |
| `toBeEmpty` | `to.be.empty` | yes |
| `toBeEnabled` | `to.be.enabled` / `to.be.disabled` | yes |
| `toBeFocused` | `to.be.focused` | yes |
| `toBeHidden` | `to.be.hidden` | yes |
| `toBeInViewport` | `to.be.in.viewport` | yes |
| `toBeVisible` | `to.be.visible` / `to.be.hidden` | yes |
| `toContainClass` | `to.contain.class` / `.array` | yes |
| `toContainText` | `to.contain.text.array` / `to.have.text` | yes |
| `toHaveAccessibleDescription` | `to.have.accessible.description` | yes |
| `toHaveAccessibleErrorMessage` | `to.have.accessible.error.message` | yes |
| `toHaveAccessibleName` | `to.have.accessible.name` | yes |
| `toHaveAttribute` | `to.have.attribute` / `.value` | yes |
| `toHaveClass` | `to.have.class` / `.array` | yes |
| `toHaveCount` | `to.have.count` | yes (array path, `src/page.ts:483`) |
| `toHaveCSS` | `to.have.css` | yes |
| `toHaveId` | `to.have.id` | yes |
| `toHaveJSProperty` | `to.have.property` | yes |
| `toHaveRole` | `to.have.role` | yes |
| `toHaveText` | `to.have.text` / `.array` | yes |
| `toHaveValue` | `to.have.value` | yes |
| `toHaveValues` | `to.have.values` | yes |
| `toMatchAriaSnapshot` (Locator) | `to.match.aria` | yes; the adapter pre-parses the YAML template (`src/page.ts:503-509`) |
| `toHaveTitle` | `to.have.title` | expression exists in the InjectedScript, but there is no `Page._expect` to reach it |
| `toHaveURL` | `to.have.url` | same; also needs `page.context()` / `waitForURL` |
| `toHaveScreenshot` | `_expectScreenshot` (not `_expect`) | no |

Reviewed corpus evidence for the hook: 36 baseline entries recorded under method
`Locator._expect` (`tests/upstream/baseline.json`), all reached through the test bridge —
34 of them `page-aria-snapshot*.spec.ts` / `selectors-*.spec.ts`, plus three
`locator-is-visible.spec.ts` and one `locator-query.spec.ts`. No baseline entry for any
`Page`-level assertion. No baseline entry for any `JSHandle` member.

---

## 4. Where the existing `elementHandleLimitations` footnote is wrong or incomplete

`compatibility/api.ts:57-58`.

| footnote claim | verdict | fact |
| --- | --- | --- |
| "Pointer actions `click()`, `dblclick()`, `hover()`, `check()`, `uncheck()`, and `setChecked()` are implemented, but `signal` is unsupported" | **wrong** | `signal` is in the supported list (`src/page.ts:3714-3716`), validated (`src/protocolValidation.ts:31`), stored on the action deadline (`src/page.ts:1823-1829`) and checked on every retry (`src/page.ts:1831-1840`). Passing `signal` does not throw and does abort the action. |
| "`waitForSelector()` rejects `signal` and `strict`" | **half wrong** | `strict` is rejected (`src/page.ts:3836-3837`). `signal` is accepted: allowed key at `src/page.ts:3826-3832`, validated at `src/page.ts:3835`, pre-checked at `src/page.ts:2155`, and honoured in the retry wait at `src/page.ts:2177`. |
| "`inputValue()` ignores `timeout`" | **over-claimed** | Pinned `ElementHandle.inputValue`'s `timeout` is `@deprecated This option is ignored. The value is returned immediately.` (types.d.ts, `inputValue` block). Ignoring it is upstream behaviour, so by the AGENTS.md rule "Do not call normal Playwright behavior a limitation" this is not a difference. |
| missing-member list (18 names) | **correct and complete** | 45 pinned members − 27 implemented = 18; the names match exactly. |
| "`click()` and `dblclick()` also reject `steps`" | **correct** | `steps` is absent from the supported list (`src/page.ts:3717-3727`) and rejected at `src/page.ts:3740-3748`. |
| "`click()` does not wait for navigation" | **correct** | no navigation wait anywhere in `performPointerAction` (`src/page.ts:567-688`). |
| "Their `$()` ignores `strict`" | **correct** | `src/elementHandle.ts:87-95` passes `false` unconditionally and accepts no options argument. |
| "`waitForElementState()` rejects `signal`" | **correct** | `src/page.ts:3862-3865` rejects every key but `timeout`. |
| "`evaluate()` rejects `exposeFunctions: true`" | **correct** | `src/evaluation.ts:27-28`. |
| — | **incomplete** | The footnote says nothing about `JSHandle`. The `JSHandle` surface is only referenced obliquely from the `Page.waitForFunction` row (`compatibility/api.ts:210-212`); 6 of its 8 members are missing and no ledger row or footnote names them. |
| — | **incomplete** | The footnote does not state that `ElementHandle` has no `[Symbol.asyncDispose]` consequence for `await using`, beyond listing the member. (Listing it is arguably sufficient; noted for triage.) |

---

## 5. Additional observations (outside the README difference vocabulary)

Message-text differences, recorded for completeness; they are not option/return/semantic
differences.

1. `elementHandle.waitForSelector` reports its timeout as
   `page.waitForSelector: Timeout <n>ms exceeded.` — `waitForSelectorInRoot` hard-codes the
   `page.` prefix regardless of root (`src/page.ts:2172-2175`).
2. `Page.waitForSelector` wraps abort errors with `withAbortPrefix("page.waitForSelector", …)`
   (`src/page.ts:407`), but `waitForSelectorWithinElement` does not
   (`src/page.ts:412-418`), so an aborted `elementHandle.waitForSelector` produces an
   unprefixed error.
3. Unsupported-option errors from `elementHandle.check()` / `uncheck()` are emitted with the
   method name `setChecked`, because `setCheckedSelector` always calls
   `assertPointerActionOptions("setChecked", options)` (`src/page.ts:838`). Action errors are
   correctly prefixed (`elementHandle.check:` …) via the label regex at `src/page.ts:681-685`,
   as asserted in `tests/contract/element-handle.test.ts:188-204`.
4. A disposed `AdapterElementHandle` throws `ElementHandle has been disposed`
   (`src/elementHandle.ts:262-266`); a disposed `AdapterJSHandle` throws
   `JSHandle is disposed!` (`src/evaluation.ts:190`). The `JSHandle` message matches the
   pinned client; the `ElementHandle` message was not compared against a pinned string.

## 6. Could not determine

- Whether the pinned Playwright `ElementHandle` disposed-object error message matches
  `ElementHandle has been disposed` (item 5.4). The pinned message is produced in the
  browser-protocol channel, which has no counterpart here; no unchanged upstream spec in the
  corpus asserts it.
- Runtime confirmation of any claim: per the task, no test suite was run. Every state above is
  read from the pinned types and `src/`, cross-checked against `tests/contract/` and
  `tests/upstream/baseline.json`.
- Whether `steps` (click/dblclick) and `signal` (waitForElementState) are *intentionally*
  rejected versus not yet implemented — the code rejects them, but no ADR or comment states
  intent. `docs/adr/0001-*.md` and `docs/adr/0002-*.md` cover the single-document adapter and
  the corpus, not per-option scope.
