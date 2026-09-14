from pathlib import Path
import os
import subprocess
import sys


def git_show(spec: str) -> str:
    return subprocess.check_output(["git", "show", spec], text=True)


def replace_exact(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    return text.replace(old, new)


api_source = Path(sys.argv[1])

prettier = (
    git_show("origin/main:.prettierignore").rstrip()
    + "\n\n# Markdown template; the generator formats its rendered output.\nREADME.hbs\n"
)
Path(".prettierignore").write_text(prettier)

agents = git_show("origin/main:AGENTS.md")
consumer = """## Consumer README

`README.md` is generated from `README.hbs` and `compatibility/api.ts`. Edit those
sources, not the output, then run `pnpm generate:readme`. `pnpm check` rejects drift.

The README is for consumers. Keep contributor setup, Devbox, CI, implementation
architecture, and corpus/baseline mechanics out of it. Installation instructions
must describe a verified distribution path, not an assumed registry release.

Runtime boundaries are constraints of running inside the current document.
Explain them once in that section; they do not by themselves downgrade an API.
Compatibility notes describe concrete differences from the pinned Playwright
public JavaScript API: name missing options or input forms, and contrast changed
selection behavior or return values with Playwright. Do not call normal
Playwright behavior a limitation. Avoid undefined terms such as \"limited\";
list the exact returned-handle differences once and reference them from rows.

Use Playwright's public JavaScript terminology and this package's public exports.
Do not document internal types/helpers as consumer API, or borrow type names from
other language bindings. Use the documented object shape when no public type is
named. Link members to verified official Playwright documentation. When inherited
behavior is documented on a guide or release note instead of a member page, link
the nearest official documentation rather than inventing an anchor.

Live documentation links are navigation, not compatibility evidence. Review the
pinned signatures, implementation, unchanged upstream tests, and reviewed evidence
before changing a ledger claim. When support or evidence changes, update the
ledger and regenerate in the same change. Keep section-specific editing guidance
in Handlebars comments so it does not appear in the generated README.

"""
marker = "## Development environment\n"
if agents.count(marker) != 1:
    raise SystemExit("AGENTS.md development marker changed")
Path("AGENTS.md").write_text(agents.replace(marker, consumer + marker))

api = api_source.read_text()
old_limitations = '  "Returned `ElementHandle` objects do not implement `check()`, `click()`, `contentFrame()`, `dblclick()`, `dispatchEvent()`, `fill()`, `focus()`, `hover()`, `ownerFrame()`, `press()`, `screenshot()`, `scrollIntoViewIfNeeded()`, `selectOption()`, `selectText()`, `setChecked()`, `setInputFiles()`, `tap()`, `type()`, `uncheck()`, `evaluateHandle()`, `jsonValue()`, `getProperties()`, `getProperty()`, or `[Symbol.asyncDispose]()`. Their `$()` ignores `strict`; `inputValue()` ignores `timeout`; `waitForElementState()` rejects `signal`; `waitForSelector()` rejects `signal` and `strict`; `evaluate()` rejects `exposeFunctions: true`.";'
new_limitations = '  "Returned `ElementHandle` objects do not implement `contentFrame()`, `dispatchEvent()`, `fill()`, `focus()`, `ownerFrame()`, `press()`, `screenshot()`, `scrollIntoViewIfNeeded()`, `selectOption()`, `selectText()`, `setInputFiles()`, `tap()`, `type()`, `evaluateHandle()`, `jsonValue()`, `getProperties()`, `getProperty()`, or `[Symbol.asyncDispose]()`. Pointer actions `click()`, `dblclick()`, `hover()`, `check()`, `uncheck()`, and `setChecked()` are implemented, but `signal` is unsupported; `click()` and `dblclick()` also reject `steps`, and `click()` does not wait for navigation. Their `$()` ignores `strict`; `inputValue()` ignores `timeout`; `waitForElementState()` rejects `signal`; `waitForSelector()` rejects `signal` and `strict`; `evaluate()` rejects `exposeFunctions: true`.";'
api = replace_exact(api, old_limitations, new_limitations, "ElementHandle limitations")

replacements = [
    (
        '  check: partial(\n    "Multiple matches throw instead of selecting the first match. Unsupported options: `force`, `scroll`, `signal`, `strict`."\n  ),',
        '  check: partial("The `signal` option is unsupported."),',
        "Page.check",
    ),
    (
        '  click: partial(\n    "Multiple matches throw instead of selecting the first match. Unsupported options: `button`, `clickCount`, `delay`, `force`, `modifiers`, `scroll`, `signal`, `strict`."\n  ),',
        '  click: partial(\n    "The `signal` option is unsupported. The action does not wait for navigation."\n  ),',
        "Page.click",
    ),
    (
        '  dblclick: partial(\n    "Multiple matches throw instead of selecting the first match. Unsupported options: `button`, `delay`, `force`, `modifiers`, `scroll`, `signal`, `strict`."\n  ),',
        '  dblclick: partial("The `signal` option is unsupported."),',
        "Page.dblclick",
    ),
    (
        '  hover: partial(\n    "Multiple matches throw instead of selecting the first match. Unsupported options: `force`, `modifiers`, `position`, `scroll`, `signal`, `strict`, `trial`."\n  ),',
        '  hover: partial("The `signal` option is unsupported."),',
        "Page.hover",
    ),
    (
        '  setChecked: partial(\n    "Multiple matches throw instead of selecting the first match. Unsupported options: `force`, `scroll`, `signal`, `strict`."\n  ),',
        '  setChecked: partial("The `signal` option is unsupported."),',
        "Page.setChecked",
    ),
    (
        '  uncheck: partial(\n    "Multiple matches throw instead of selecting the first match. Unsupported options: `force`, `scroll`, `signal`, `strict`."\n  ),',
        '  uncheck: partial("The `signal` option is unsupported."),',
        "Page.uncheck",
    ),
    (
        '  check: partial("Unsupported options: `force`, `scroll`, `signal`."),',
        '  check: partial("The `signal` option is unsupported."),',
        "Locator.check",
    ),
    (
        '  click: partial(\n    "Unsupported options: `button`, `clickCount`, `delay`, `force`, `modifiers`, `scroll`, `signal`, `steps`."\n  ),',
        '  click: partial(\n    "Unsupported options: `signal`, `steps`. The action does not wait for navigation."\n  ),',
        "Locator.click",
    ),
    (
        '  dblclick: partial(\n    "Unsupported options: `button`, `delay`, `force`, `modifiers`, `scroll`, `signal`, `steps`."\n  ),',
        '  dblclick: partial("Unsupported options: `signal`, `steps`."),',
        "Locator.dblclick",
    ),
    (
        '  hover: partial(\n    "Unsupported options: `force`, `modifiers`, `position`, `scroll`, `signal`, `trial`."\n  ),',
        '  hover: partial("The `signal` option is unsupported."),',
        "Locator.hover",
    ),
    (
        '  setChecked: partial("Unsupported options: `force`, `scroll`, `signal`."),',
        '  setChecked: partial("The `signal` option is unsupported."),',
        "Locator.setChecked",
    ),
    (
        '  uncheck: partial("Unsupported options: `force`, `scroll`, `signal`."),',
        '  uncheck: partial("The `signal` option is unsupported."),',
        "Locator.uncheck",
    ),
]
for old, new, label in replacements:
    api = replace_exact(api, old, new, label)
Path("compatibility/api.ts").write_text(api)
